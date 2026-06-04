/**
 * TradingView Real-Time Data Connector
 * Uses tradingview-ws library for WebSocket connection to TradingView
 */

import WebSocket from 'ws';
import randomstring from 'randomstring';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RealtimeQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  timestamp: number;
}

export type TradingviewTimeframe = number | '1D' | '1W' | '1M';

type Subscriber = (event: { name: string; params: any[] }) => void;
type Unsubscriber = () => void;

interface TradingviewConnection {
  subscribe: (handler: Subscriber) => Unsubscriber;
  send: (name: string, params: any[]) => void;
  close: () => Promise<void>;
  isConnected: () => boolean;
}

// Parse TradingView WebSocket messages
function parseMessage(message: string): Array<{ type: string; data: any }> {
  if (message.length === 0) return [];
  const events = message.toString().split(/~m~\d+~m~/).slice(1);

  return events.map(event => {
    if (event.substring(0, 3) === "~h~") {
      return { type: 'ping', data: `~m~${event.length}~m~${event}` };
    }
    try {
      const parsed = JSON.parse(event);
      if (parsed['session_id']) return { type: 'session', data: parsed };
      return { type: 'event', data: parsed };
    } catch {
      return { type: 'unknown', data: event };
    }
  });
}

// Connect to TradingView WebSocket
export async function connectToTradingView(sessionId?: string): Promise<TradingviewConnection> {
  let token = 'unauthorized_user_token';
  let connected = false;

  const connection = new WebSocket("wss://data.tradingview.com/socket.io/websocket", {
    origin: "https://data.tradingview.com",
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const subscribers: Set<Subscriber> = new Set();

  function subscribe(handler: Subscriber): Unsubscriber {
    subscribers.add(handler);
    return () => { subscribers.delete(handler); };
  }

  function send(name: string, params: any[]) {
    const data = JSON.stringify({ m: name, p: params });
    const message = "~m~" + data.length + "~m~" + data;
    if (connection.readyState === WebSocket.OPEN) {
      connection.send(message);
    }
  }

  function isConnected() { return connected; }

  async function close() {
    return new Promise<void>((resolve, reject) => {
      connection.on('close', () => { connected = false; resolve(); });
      connection.on('error', reject);
      connection.close();
    });
  }

  return new Promise<TradingviewConnection>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);

    connection.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });

    connection.on('message', (message: Buffer) => {
      const payloads = parseMessage(message.toString());

      for (const payload of payloads) {
        switch (payload.type) {
          case 'ping':
            connection.send(payload.data);
            break;
          case 'session':
            connected = true;
            send('set_auth_token', [token]);
            clearTimeout(timeout);
            resolve({ subscribe, send, close, isConnected });
            break;
          case 'event':
            if (payload.data && payload.data.m) {
              const event = { name: payload.data.m, params: payload.data.p || [] };
              subscribers.forEach(handler => handler(event));
            }
            break;
        }
      }
    });
  });
}

// Fetch historical candles for a symbol
export async function getCandles(
  connection: TradingviewConnection,
  symbol: string,
  timeframe: TradingviewTimeframe = 60,
  amount: number = 300
): Promise<Candle[]> {
  const chartSession = "cs_" + randomstring.generate(12);
  const maxBatch = 5000;
  const batchSize = Math.min(amount, maxBatch);

  return new Promise<Candle[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout fetching candles for ${symbol}`));
    }, 30000);

    let candles: Array<{ i: number; v: number[] }> = [];

    const unsubscribe = connection.subscribe(event => {
      if (event.name === 'timescale_update') {
        const newCandles = event.params[1]?.['sds_1']?.['s'];
        if (newCandles) {
          candles = newCandles.concat(candles);
        }
        return;
      }

      if (['series_completed', 'symbol_error'].includes(event.name)) {
        clearTimeout(timeout);
        unsubscribe();

        if (event.name === 'symbol_error') {
          reject(new Error(`Symbol error for ${symbol}`));
          return;
        }

        const result: Candle[] = candles
          .slice(0, amount)
          .map(c => ({
            timestamp: c.v[0],
            open: c.v[1],
            high: c.v[2],
            low: c.v[3],
            close: c.v[4],
            volume: c.v[5] || 0
          }));

        resolve(result);
      }
    });

    connection.send('chart_create_session', [chartSession, '']);
    connection.send('resolve_symbol', [
      chartSession,
      'sds_sym_0',
      '=' + JSON.stringify({ symbol, adjustment: 'splits' })
    ]);
    connection.send('create_series', [
      chartSession, 'sds_1', 's0', 'sds_sym_0', timeframe.toString(), batchSize, ''
    ]);
  });
}

// Subscribe to real-time quote updates
export function subscribeToQuotes(
  connection: TradingviewConnection,
  symbols: string[],
  onQuote: (quote: RealtimeQuote) => void
): Unsubscriber {
  const quoteSession = "qs_" + randomstring.generate(12);
  
  connection.send('quote_create_session', [quoteSession]);
  
  for (const symbol of symbols) {
    connection.send('quote_add_symbols', [quoteSession, symbol]);
    connection.send('quote_fast_symbols', [quoteSession, symbol]);
  }

  const unsubscribe = connection.subscribe(event => {
    if (event.name === 'qsd') {
      const data = event.params[1];
      if (data && data.v) {
        const v = data.v;
        onQuote({
          symbol: data.n || '',
          price: v.lp || v.ask || 0,
          change: v.ch || 0,
          changePercent: v.chp || 0,
          volume: v.volume || 0,
          high: v.high_price || 0,
          low: v.low_price || 0,
          timestamp: Date.now()
        });
      }
    }
  });

  return () => {
    connection.send('quote_remove_symbols', [quoteSession, ...symbols]);
    unsubscribe();
  };
}

// Get candles for multiple timeframes (for MTF analysis)
export async function getMultiTimeframeData(
  connection: TradingviewConnection,
  symbol: string,
  candlesPerTf: number = 200
): Promise<Record<string, Candle[]>> {
  const timeframes: Record<string, TradingviewTimeframe> = {
    'D': '1D',
    'H4': 240,
    'H1': 60,
    'M15': 15,
    'M5': 5
  };

  const result: Record<string, Candle[]> = {};

  for (const [label, tf] of Object.entries(timeframes)) {
    try {
      console.log(`  Fetching ${label} candles for ${symbol}...`);
      result[label] = await getCandles(connection, symbol, tf, candlesPerTf);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Failed to fetch ${label}: ${err}`);
      result[label] = [];
    }
  }

  return result;
}
