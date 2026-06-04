/**
 * Trading Terminal Server v3.0
 * - TradingView-style UI
 * - Paper trading simulation (auto buy/sell on signals, TP/SL tracking)
 * - Live candle bar with countdown timer
 * - Multi-symbol watchlist
 * - Sound alerts
 * - Forex Factory news feed
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import axios from 'axios';
import { connectToTradingView, getMultiTimeframeData, subscribeToQuotes, RealtimeQuote } from '../data/tradingview-connector.js';
import { performMultiTimeframeAnalysis } from '../analysis/multi-timeframe.js';
import { loadMemory, getPerformanceSummary } from '../agent/memory.js';
import { assessPsychologyState } from '../knowledge/trading-in-the-zone.js';
import { PaperTradingEngine } from '../agent/paper-trading.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Global paper trading engine (persists across connections)
const paperEngine = new PaperTradingEngine(10000);
const activeQuotes: Record<string, RealtimeQuote> = {};

// Forex Factory news cache
let newsCache: any[] = [];
let newsLastFetch = 0;

async function fetchForexFactoryNews(): Promise<any[]> {
  const now = Date.now();
  if (now - newsLastFetch < 5 * 60 * 1000 && newsCache.length > 0) {
    return newsCache;
  }
  try {
    // Forex Factory calendar XML/JSON
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    
    const resp = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (resp.data && Array.isArray(resp.data)) {
      newsCache = resp.data.map((item: any) => ({
        title: item.title || '',
        country: item.country || '',
        date: item.date || '',
        time: item.time || '',
        impact: item.impact || 'Low',
        forecast: item.forecast || '',
        previous: item.previous || '',
        actual: item.actual || ''
      }));
      newsLastFetch = now;
    }
  } catch (err) {
    console.error('Forex Factory fetch error:', err);
    // Fallback: return cached or empty
  }
  return newsCache;
}

app.get('/', (req, res) => {
  res.send(getTerminalHTML());
});

app.get('/api/news', async (req, res) => {
  const news = await fetchForexFactoryNews();
  res.json(news);
});

io.on('connection', (socket) => {
  console.log('🖥️  Terminal client connected');

  const memory = loadMemory();
  socket.emit('memory', {
    performance: getPerformanceSummary(memory),
    lessons: memory.lessons.slice(0, 5).map(l => l.lesson),
    totalTrades: memory.performance.totalTrades
  });

  // Send current paper account state
  socket.emit('paper-account', paperEngine.getAccount());
  socket.emit('watchlist-update', activeQuotes);

  let tvConnection: any = null;
  let unsubQuotes: (() => void) | null = null;
  let analysisInterval: NodeJS.Timeout | null = null;
  let autoTradeEnabled = true;

  socket.on('subscribe-watchlist', async (data) => {
    const { symbols } = data;
    socket.emit('status', { message: `Connecting for watchlist...` });

    try {
      if (!tvConnection) {
        tvConnection = await connectToTradingView();
      }

      unsubQuotes = subscribeToQuotes(tvConnection, symbols, (quote) => {
        activeQuotes[quote.symbol] = quote;
        socket.emit('quote', quote);

        // Paper trading: update positions with every tick
        const closed = paperEngine.updatePositions(quote.price, quote.symbol);
        if (closed.length > 0) {
          closed.forEach(t => {
            socket.emit('trade-closed', t);
          });
          socket.emit('paper-account', paperEngine.getAccount());
        }

        // Send open positions update
        socket.emit('open-positions', paperEngine.getOpenPositions());
      });

      socket.emit('status', { message: `Live: ${symbols.length} symbols` });
    } catch (err) {
      socket.emit('error', { message: `Watchlist failed: ${err}` });
    }
  });

  socket.on('request-analysis', async (data) => {
    const { symbol } = data;
    socket.emit('status', { message: `Analyzing ${symbol}...` });

    try {
      if (!tvConnection) {
        tvConnection = await connectToTradingView();
      }

      const mtfData = await getMultiTimeframeData(tvConnection, symbol, 200);
      const analysis = performMultiTimeframeAnalysis(mtfData, symbol);

      socket.emit('analysis', analysis);
      socket.emit('candles', {
        symbol,
        timeframes: Object.fromEntries(
          Object.entries(mtfData).map(([tf, candles]) => [tf, candles.slice(-200)])
        )
      });

      // Auto-execute paper trade if signal and auto-trade enabled
      if (analysis.signal && autoTradeEnabled) {
        const trade = paperEngine.executeSignal(analysis.signal, symbol);
        if (trade) {
          socket.emit('trade-opened', trade);
          socket.emit('paper-account', paperEngine.getAccount());
        }
      }

      // Auto-refresh every 60s
      if (analysisInterval) clearInterval(analysisInterval);
      analysisInterval = setInterval(async () => {
        try {
          if (tvConnection && tvConnection.isConnected()) {
            const freshData = await getMultiTimeframeData(tvConnection, symbol, 200);
            const freshAnalysis = performMultiTimeframeAnalysis(freshData, symbol);
            socket.emit('analysis', freshAnalysis);
            socket.emit('candles', {
              symbol,
              timeframes: Object.fromEntries(
                Object.entries(freshData).map(([tf, candles]) => [tf, candles.slice(-200)])
              )
            });

            // Auto-execute new signal
            if (freshAnalysis.signal && autoTradeEnabled) {
              const trade = paperEngine.executeSignal(freshAnalysis.signal, symbol);
              if (trade) {
                socket.emit('trade-opened', trade);
                socket.emit('paper-account', paperEngine.getAccount());
              }
            }
          }
        } catch (err) {
          console.error('Refresh error:', err);
        }
      }, 60000);

      socket.emit('status', { message: `Live: ${symbol}` });
    } catch (err) {
      socket.emit('error', { message: `Analysis failed: ${err}` });
    }
  });

  // Fetch news
  socket.on('request-news', async () => {
    const news = await fetchForexFactoryNews();
    socket.emit('news-update', news);
  });

  // Paper trading controls
  socket.on('toggle-auto-trade', (enabled) => {
    autoTradeEnabled = enabled;
    socket.emit('status', { message: `Auto-trade: ${enabled ? 'ON' : 'OFF'}` });
  });

  socket.on('manual-close', (data) => {
    const { tradeId, price } = data;
    const closed = paperEngine.manualClose(tradeId, price);
    if (closed) {
      socket.emit('trade-closed', closed);
      socket.emit('paper-account', paperEngine.getAccount());
    }
  });

  socket.on('reset-account', (data) => {
    paperEngine.reset(data?.balance || 10000);
    socket.emit('paper-account', paperEngine.getAccount());
  });

  socket.on('disconnect', () => {
    if (analysisInterval) clearInterval(analysisInterval);
    if (unsubQuotes) unsubQuotes();
    if (tvConnection) tvConnection.close().catch(() => {});
    tvConnection = null;
    console.log('🖥️  Terminal client disconnected');
  });
});

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        🤖 TRADING BOT AGENT TERMINAL v3.0                ║
╠══════════════════════════════════════════════════════════╣
║  http://localhost:${PORT}                                  ║
║                                                          ║
║  ✨ Paper Trading Simulation (auto buy/sell)             ║
║  ✨ Live Candle Bar with Countdown Timer                 ║
║  ✨ Forex Factory News Feed                              ║
║  ✨ Multi-Symbol Watchlist                               ║
║  ✨ Sound Alerts on Signals                              ║
║  ✨ W/L Performance Tracking                             ║
╚══════════════════════════════════════════════════════════╝
  `);
  
  // Pre-fetch news on boot
  fetchForexFactoryNews();
});

function getTerminalHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Bot Agent v3</title>
  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root {
      --bg-primary: #131722;
      --bg-secondary: #1e222d;
      --bg-tertiary: #2a2e39;
      --bg-hover: #363a45;
      --border: #2a2e39;
      --text-primary: #d1d4dc;
      --text-secondary: #787b86;
      --text-muted: #4c525e;
      --green: #26a69a;
      --red: #ef5350;
      --blue: #2962ff;
      --yellow: #ff9800;
      --purple: #ab47bc;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Trebuchet MS',Roboto,sans-serif; background:var(--bg-primary); color:var(--text-primary); overflow:hidden; height:100vh; }

    /* TOOLBAR */
    .toolbar { height:40px; background:var(--bg-secondary); border-bottom:1px solid var(--border); display:flex; align-items:center; padding:0 8px; gap:2px; }
    .tb-group { display:flex; align-items:center; gap:2px; padding:0 8px; border-right:1px solid var(--border); height:100%; }
    .tb-group:last-child { border-right:none; }
    .tb-btn { background:none; border:none; color:var(--text-secondary); padding:5px 10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500; transition:all .15s; }
    .tb-btn:hover { background:var(--bg-tertiary); color:var(--text-primary); }
    .tb-btn.active { background:var(--blue); color:#fff; }
    .tb-btn.symbol-btn { font-size:14px; font-weight:700; color:var(--text-primary); }
    .tb-price { font-size:20px; font-weight:700; padding:0 10px; }
    .tb-price.up { color:var(--green); }
    .tb-price.down { color:var(--red); }
    .tb-change { font-size:11px; padding:2px 6px; border-radius:3px; }
    .tb-change.up { color:var(--green); background:rgba(38,166,154,.1); }
    .tb-change.down { color:var(--red); background:rgba(239,83,80,.1); }
    .tb-spacer { flex:1; }
    .tb-countdown { font-size:12px; font-weight:600; color:var(--yellow); padding:0 8px; font-family:monospace; }
    .switch { position:relative; display:inline-block; width:32px; height:18px; }
    .switch input { opacity:0; width:0; height:0; }
    .slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:var(--bg-tertiary); border-radius:9px; transition:.3s; }
    .slider:before { position:absolute; content:""; height:14px; width:14px; left:2px; bottom:2px; background:#fff; border-radius:50%; transition:.3s; }
    input:checked+.slider { background:var(--green); }
    input:checked+.slider:before { transform:translateX(14px); }

    /* MAIN LAYOUT */
    .main { display:grid; grid-template-columns:50px 200px 1fr 300px; grid-template-rows:1fr 160px; height:calc(100vh - 40px); }

    /* ICON BAR */
    .iconbar { background:var(--bg-secondary); border-right:1px solid var(--border); display:flex; flex-direction:column; align-items:center; padding-top:8px; gap:2px; grid-row:1/3; }
    .ib { width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:6px; cursor:pointer; font-size:16px; border:none; background:none; color:var(--text-secondary); transition:.15s; }
    .ib:hover { background:var(--bg-tertiary); color:var(--text-primary); }
    .ib.active { color:var(--blue); background:var(--bg-tertiary); }
    .ib-div { width:24px; height:1px; background:var(--border); margin:4px 0; }

    /* WATCHLIST */
    .wl-panel { background:var(--bg-primary); border-right:1px solid var(--border); overflow-y:auto; grid-row:1/3; }
    .wl-head { padding:8px 10px; font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg-primary); z-index:1; }
    .wl-item { display:grid; grid-template-columns:1fr auto; padding:8px 10px; cursor:pointer; border-bottom:1px solid rgba(42,46,57,.3); transition:.1s; }
    .wl-item:hover { background:var(--bg-secondary); }
    .wl-item.active { background:var(--bg-tertiary); border-left:2px solid var(--blue); }
    .wl-sym { font-size:12px; font-weight:600; }
    .wl-name { font-size:9px; color:var(--text-muted); margin-top:1px; }
    .wl-pr { text-align:right; font-size:12px; font-weight:500; }
    .wl-pr.up { color:var(--green); }
    .wl-pr.down { color:var(--red); }
    .wl-ch { text-align:right; font-size:9px; }
    .wl-ch.up { color:var(--green); }
    .wl-ch.down { color:var(--red); }

    /* CHART */
    .chart-area { background:var(--bg-primary); position:relative; overflow:hidden; }
    #chart { width:100%; height:100%; }

    /* RIGHT PANEL */
    .rpanel { background:var(--bg-primary); border-left:1px solid var(--border); overflow-y:auto; grid-row:1/3; font-size:11px; }
    .rp-sec { border-bottom:1px solid var(--border); padding:10px; }
    .rp-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); margin-bottom:8px; }

    /* PAPER ACCOUNT */
    .acct-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px; }
    .acct-item { background:var(--bg-secondary); border-radius:4px; padding:6px 8px; }
    .acct-label { font-size:9px; color:var(--text-muted); }
    .acct-val { font-size:13px; font-weight:700; margin-top:2px; }
    .acct-val.up { color:var(--green); }
    .acct-val.down { color:var(--red); }

    /* POSITIONS */
    .pos-item { background:var(--bg-secondary); border-radius:6px; padding:8px; margin-bottom:6px; border-left:3px solid var(--text-muted); }
    .pos-item.long { border-left-color:var(--green); }
    .pos-item.short { border-left-color:var(--red); }
    .pos-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
    .pos-dir { font-weight:700; font-size:11px; }
    .pos-dir.long { color:var(--green); }
    .pos-dir.short { color:var(--red); }
    .pos-close-btn { background:var(--bg-tertiary); border:none; color:var(--text-secondary); padding:2px 6px; border-radius:3px; cursor:pointer; font-size:9px; }
    .pos-close-btn:hover { background:var(--red); color:#fff; }
    .pos-detail { color:var(--text-muted); font-size:10px; line-height:1.6; }

    /* SIGNAL BOX */
    .sig-box { background:var(--bg-secondary); border-radius:6px; padding:10px; border-top:3px solid var(--text-muted); }
    .sig-box.long { border-top-color:var(--green); }
    .sig-box.short { border-top-color:var(--red); }
    .sig-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    .sig-dir { font-size:14px; font-weight:800; }
    .sig-dir.long { color:var(--green); }
    .sig-dir.short { color:var(--red); }
    .sig-grade { padding:2px 6px; border-radius:3px; font-size:10px; font-weight:700; color:#fff; }
    .sig-grade.A { background:var(--green); }
    .sig-grade.B { background:var(--blue); }
    .sig-grade.C { background:var(--yellow); color:#000; }
    .sig-levels { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; font-size:10px; }
    .sig-lbl { color:var(--text-muted); }
    .sig-val { font-weight:600; text-align:right; }

    /* NEWS */
    .news-item { padding:6px 0; border-bottom:1px solid rgba(42,46,57,.3); }
    .news-item:last-child { border-bottom:none; }
    .news-time { color:var(--text-muted); font-size:9px; }
    .news-title { font-size:10px; margin-top:2px; }
    .news-impact { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; }
    .news-impact.High { background:var(--red); }
    .news-impact.Medium { background:var(--yellow); }
    .news-impact.Low { background:var(--text-muted); }

    /* MTF */
    .mtf-row { display:flex; align-items:center; padding:4px 0; }
    .mtf-lbl { width:30px; font-size:10px; font-weight:600; color:var(--text-secondary); }
    .mtf-bar { flex:1; height:5px; background:var(--bg-tertiary); border-radius:3px; overflow:hidden; margin:0 6px; }
    .mtf-fill { height:100%; border-radius:3px; transition:.4s; }
    .mtf-bias { width:40px; text-align:right; font-size:9px; font-weight:600; }
    .mtf-bias.bullish { color:var(--green); }
    .mtf-bias.bearish { color:var(--red); }
    .mtf-bias.neutral { color:var(--yellow); }

    /* CM */
    .cm-bar { height:8px; background:var(--bg-tertiary); border-radius:4px; overflow:hidden; margin:6px 0 4px; }
    .cm-fill { height:100%; border-radius:4px; transition:.5s; }
    .cm-lbl { display:flex; justify-content:space-between; font-size:9px; color:var(--text-muted); }

    /* LOG */
    .log-panel { background:var(--bg-secondary); border-top:1px solid var(--border); overflow-y:auto; padding:6px 10px; font-family:'JetBrains Mono',monospace; font-size:10px; grid-column:3/4; }
    .log-line { padding:1px 0; display:flex; gap:6px; }
    .log-t { color:var(--text-muted); min-width:60px; }
    .log-m { color:var(--text-secondary); }
    .log-m.info { color:var(--blue); }
    .log-m.signal { color:var(--green); font-weight:600; }
    .log-m.warn { color:var(--yellow); }
    .log-m.error { color:var(--red); }
    .log-m.trade { color:var(--purple); font-weight:600; }

    /* TRADE HISTORY */
    .th-item { display:grid; grid-template-columns:auto 1fr auto; gap:6px; padding:4px 0; border-bottom:1px solid rgba(42,46,57,.3); align-items:center; }
    .th-dir { font-weight:700; font-size:10px; padding:1px 4px; border-radius:2px; }
    .th-dir.long { color:var(--green); background:rgba(38,166,154,.1); }
    .th-dir.short { color:var(--red); background:rgba(239,83,80,.1); }
    .th-info { font-size:9px; color:var(--text-muted); }
    .th-pnl { font-weight:700; font-size:11px; }
    .th-pnl.win { color:var(--green); }
    .th-pnl.loss { color:var(--red); }

    /* Notification */
    .notif { position:fixed; top:50px; right:20px; background:var(--bg-secondary); border:1px solid var(--green); border-radius:10px; padding:14px 18px; z-index:9999; animation:slideIn .3s; box-shadow:0 8px 32px rgba(0,0,0,.5); max-width:280px; }
    .notif.short { border-color:var(--red); }
    @keyframes slideIn { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
    .notif-x { position:absolute; top:6px; right:10px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:14px; }
    .notif-title { font-size:13px; font-weight:700; }
    .notif-title.long { color:var(--green); }
    .notif-title.short { color:var(--red); }
    .notif-body { font-size:10px; color:var(--text-secondary); line-height:1.6; margin-top:4px; }

    ::-webkit-scrollbar { width:5px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:var(--bg-tertiary); border-radius:3px; }
  </style>
</head>
<body>
  <!-- TOOLBAR -->
  <div class="toolbar">
    <div class="tb-group">
      <button class="tb-btn symbol-btn" id="active-symbol" onclick="showSymbolSearch()">BTC/USDT</button>
    </div>
    <div class="tb-group" id="tf-btns">
      <button class="tb-btn" data-tf="M1">1m</button>
      <button class="tb-btn" data-tf="M5">5m</button>
      <button class="tb-btn" data-tf="M15">15m</button>
      <button class="tb-btn active" data-tf="H1">1H</button>
      <button class="tb-btn" data-tf="H4">4H</button>
      <button class="tb-btn" data-tf="D">1D</button>
    </div>
    <div class="tb-group">
      <span class="tb-price" id="tb-price">--</span>
      <span class="tb-change" id="tb-change">--</span>
    </div>
    <div class="tb-group">
      <span class="tb-countdown" id="tb-countdown">--:--</span>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group" style="gap:8px;">
      <label style="font-size:10px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;">
        Auto-Trade
        <label class="switch"><input type="checkbox" id="auto-trade-toggle" checked><span class="slider"></span></label>
      </label>
      <label style="font-size:10px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;">
        🔊
        <label class="switch"><input type="checkbox" id="sound-toggle" checked><span class="slider"></span></label>
      </label>
    </div>
    <div class="tb-group">
      <button class="tb-btn" onclick="runAnalysis()" style="color:var(--green);font-weight:700;">▶ Analyze</button>
    </div>
  </div>

  <!-- MAIN -->
  <div class="main">
    <div class="iconbar">
      <button class="ib active" title="Watchlist">📋</button>
      <button class="ib" title="Positions" onclick="showTab('positions')">💼</button>
      <button class="ib" title="History" onclick="showTab('history')">📜</button>
      <div class="ib-div"></div>
      <button class="ib" title="News" onclick="showTab('news')">📰</button>
      <button class="ib" title="Brain" onclick="showTab('brain')">🧠</button>
      <div class="ib-div"></div>
      <button class="ib" title="Reset" onclick="resetAccount()">🔄</button>
    </div>

    <div class="wl-panel">
      <div class="wl-head">Watchlist</div>
      <div id="wl-items"></div>
    </div>

    <div class="chart-area"><div id="chart"></div></div>

    <div class="rpanel" id="rpanel">
      <!-- Account Summary -->
      <div class="rp-sec">
        <div class="rp-title">💰 Paper Account</div>
        <div class="acct-grid" id="acct-grid">
          <div class="acct-item"><div class="acct-label">Balance</div><div class="acct-val" id="acct-bal">$10,000</div></div>
          <div class="acct-item"><div class="acct-label">Equity</div><div class="acct-val" id="acct-eq">$10,000</div></div>
          <div class="acct-item"><div class="acct-label">W/L</div><div class="acct-val" id="acct-wl">0/0</div></div>
          <div class="acct-item"><div class="acct-label">Win Rate</div><div class="acct-val" id="acct-wr">0%</div></div>
          <div class="acct-item"><div class="acct-label">Total P&L</div><div class="acct-val" id="acct-pnl">$0</div></div>
          <div class="acct-item"><div class="acct-label">Profit Factor</div><div class="acct-val" id="acct-pf">0</div></div>
        </div>
      </div>

      <!-- Open Positions -->
      <div class="rp-sec">
        <div class="rp-title">💼 Open Positions</div>
        <div id="positions-container"><div style="color:var(--text-muted);text-align:center;padding:8px;">No open positions</div></div>
      </div>

      <!-- Signal -->
      <div class="rp-sec">
        <div class="rp-title">🎯 Signal</div>
        <div id="signal-box"><div class="sig-box"><div style="text-align:center;color:var(--text-muted);padding:8px;">Click Analyze</div></div></div>
      </div>

      <!-- MTF -->
      <div class="rp-sec">
        <div class="rp-title">📊 Multi-Timeframe</div>
        <div id="mtf-box"></div>
        <div class="cm-bar"><div class="cm-fill" id="cm-fill" style="width:0%"></div></div>
        <div class="cm-lbl"><span>Confluence</span><span id="cm-score">0/10</span></div>
      </div>

      <!-- News -->
      <div class="rp-sec">
        <div class="rp-title">📰 Forex Factory News</div>
        <div id="news-container" style="max-height:200px;overflow-y:auto;"><div style="color:var(--text-muted);">Loading news...</div></div>
      </div>

      <!-- Trade History -->
      <div class="rp-sec">
        <div class="rp-title">📜 Trade History</div>
        <div id="history-container" style="max-height:200px;overflow-y:auto;"><div style="color:var(--text-muted);">No trades yet</div></div>
      </div>
    </div>

    <div class="log-panel" id="log-panel">
      <div class="log-line"><span class="log-t">SYS</span><span class="log-m info">Trading Bot Agent v3.0 - Paper Trading Active</span></div>
    </div>
  </div>

  <div id="notif-container"></div>

  <script>
    const socket = io();
    let chart, candleSeries, volumeSeries;
    let currentSymbol = 'BINANCE:BTCUSDT';
    let currentTF = 'H1';
    let candleData = {};
    let soundEnabled = true;
    let lastSignalId = null;
    let lastPrice = 0;
    let countdownInterval = null;
    let candleStartTime = 0;

    const WATCHLIST = [
      { symbol:'BINANCE:BTCUSDT', name:'Bitcoin', short:'BTC/USDT' },
      { symbol:'BINANCE:ETHUSDT', name:'Ethereum', short:'ETH/USDT' },
      { symbol:'TVC:GOLD', name:'Gold Spot', short:'XAU/USD' },
      { symbol:'BINANCE:SOLUSDT', name:'Solana', short:'SOL/USDT' },
      { symbol:'BINANCE:BNBUSDT', name:'BNB', short:'BNB/USDT' },
      { symbol:'FX:EURUSD', name:'EUR/USD', short:'EUR/USD' },
    ];

    const TF_SECONDS = { M1:60, M5:300, M15:900, H1:3600, H4:14400, D:86400 };

    // === AUDIO ===
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    function initAudio() { if(!audioCtx) audioCtx = new AudioCtx(); }
    function playSound(type) {
      if(!soundEnabled) return; initAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      if(type==='long') { osc.frequency.setValueAtTime(523,audioCtx.currentTime); osc.frequency.setValueAtTime(659,audioCtx.currentTime+.1); osc.frequency.setValueAtTime(784,audioCtx.currentTime+.2); }
      else if(type==='short') { osc.frequency.setValueAtTime(784,audioCtx.currentTime); osc.frequency.setValueAtTime(659,audioCtx.currentTime+.1); osc.frequency.setValueAtTime(523,audioCtx.currentTime+.2); }
      else { osc.frequency.value=880; }
      gain.gain.setValueAtTime(.25,audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.01,audioCtx.currentTime+.4);
      osc.start(); osc.stop(audioCtx.currentTime+.4);
    }
    document.getElementById('sound-toggle').addEventListener('change',e=>{ soundEnabled=e.target.checked; initAudio(); });
    document.getElementById('auto-trade-toggle').addEventListener('change',e=>{ socket.emit('toggle-auto-trade',e.target.checked); });

    // === COUNTDOWN TIMER ===
    function startCountdown() {
      if(countdownInterval) clearInterval(countdownInterval);
      countdownInterval = setInterval(()=>{
        const tfSec = TF_SECONDS[currentTF] || 3600;
        const now = Math.floor(Date.now()/1000);
        const elapsed = now % tfSec;
        const remaining = tfSec - elapsed;
        const min = Math.floor(remaining/60);
        const sec = remaining%60;
        document.getElementById('tb-countdown').textContent = (min<10?'0':'')+min+':'+(sec<10?'0':'')+sec;
      }, 1000);
    }
    startCountdown();

    // === CHART ===
    function initChart() {
      const c = document.getElementById('chart');
      chart = LightweightCharts.createChart(c, {
        width:c.clientWidth, height:c.clientHeight,
        layout:{background:{color:'#131722'},textColor:'#d1d4dc'},
        grid:{vertLines:{color:'#1e222d'},horzLines:{color:'#1e222d'}},
        crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{labelBackgroundColor:'#2962ff'},horzLine:{labelBackgroundColor:'#2962ff'}},
        timeScale:{borderColor:'#2a2e39',timeVisible:true,secondsVisible:false},
        rightPriceScale:{borderColor:'#2a2e39'}
      });
      candleSeries = chart.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderUpColor:'#26a69a',borderDownColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350'});
      volumeSeries = chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',scaleMargins:{top:.85,bottom:0}});
      new ResizeObserver(()=>chart.applyOptions({width:c.clientWidth,height:c.clientHeight})).observe(c);
    }
    initChart();

    function updateChart(candles) {
      if(!candles||!candles.length) return;
      candleSeries.setData(candles.map(c=>({time:c.timestamp,open:c.open,high:c.high,low:c.low,close:c.close})));
      volumeSeries.setData(candles.map(c=>({time:c.timestamp,value:c.volume||0,color:c.close>=c.open?'rgba(38,166,154,.3)':'rgba(239,83,80,.3)'})));
      chart.timeScale().fitContent();
    }

    // === WATCHLIST ===
    function renderWL() {
      document.getElementById('wl-items').innerHTML = WATCHLIST.map(w=>{
        const active = w.symbol===currentSymbol?' active':'';
        const id = w.symbol.replace(/[:.]/g,'-');
        return '<div class="wl-item'+active+'" onclick="selectSymbol(\\''+w.symbol+'\\')"><div><div class="wl-sym">'+w.short+'</div><div class="wl-name">'+w.name+'</div></div><div><div class="wl-pr" id="wlp-'+id+'">--</div><div class="wl-ch" id="wlc-'+id+'">--</div></div></div>';
      }).join('');
    }
    renderWL();

    function selectSymbol(sym) { currentSymbol=sym; const i=WATCHLIST.find(w=>w.symbol===sym); document.getElementById('active-symbol').textContent=i?i.short:sym; renderWL(); runAnalysis(); }
    function switchTF(tf) { currentTF=tf; document.querySelectorAll('#tf-btns .tb-btn').forEach(b=>b.classList.toggle('active',b.dataset.tf===tf)); if(candleData[tf]) updateChart(candleData[tf]); startCountdown(); }
    document.querySelectorAll('#tf-btns .tb-btn').forEach(b=>b.addEventListener('click',()=>switchTF(b.dataset.tf)));
    function runAnalysis() { log('Analyzing '+currentSymbol+'...','info'); socket.emit('request-analysis',{symbol:currentSymbol}); }
    function resetAccount() { if(confirm('Reset paper account to $10,000?')) { socket.emit('reset-account',{balance:10000}); log('Account reset','warn'); } }
    function showSymbolSearch() { const s=prompt('Symbol (e.g. BINANCE:BTCUSDT):'); if(s) selectSymbol(s); }
    function showTab(t) { /* scroll to section */ }

    // === SOCKET ===
    socket.on('connect',()=>{
      document.getElementById('tb-countdown').style.color='var(--yellow)';
      log('Connected','info');
      socket.emit('subscribe-watchlist',{symbols:WATCHLIST.map(w=>w.symbol)});
      socket.emit('request-news');
    });

    socket.on('quote',(q)=>{
      lastPrice = q.price;
      if(q.symbol===currentSymbol||q.symbol.includes(currentSymbol.split(':')[1])) {
        document.getElementById('tb-price').textContent=q.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});
        document.getElementById('tb-price').className='tb-price '+(q.changePercent>=0?'up':'down');
        const s=q.changePercent>=0?'+':'';
        document.getElementById('tb-change').textContent=s+q.changePercent.toFixed(2)+'%';
        document.getElementById('tb-change').className='tb-change '+(q.changePercent>=0?'up':'down');
      }
      const id=q.symbol.replace(/[:.]/g,'-');
      const pe=document.getElementById('wlp-'+id);
      const ce=document.getElementById('wlc-'+id);
      if(pe){pe.textContent=q.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});pe.className='wl-pr '+(q.changePercent>=0?'up':'down');}
      if(ce){const s2=q.changePercent>=0?'+':'';ce.textContent=s2+q.changePercent.toFixed(2)+'%';ce.className='wl-ch '+(q.changePercent>=0?'up':'down');}
    });

    socket.on('candles',(data)=>{
      candleData=data.timeframes;
      if(candleData[currentTF]) updateChart(candleData[currentTF]);
      else { const fb=candleData['H1']||candleData[Object.keys(candleData)[0]]; if(fb) updateChart(fb); }
    });

    socket.on('analysis',(a)=>{
      // MTF
      const tfs=['D','H4','H1','M15','M5'];
      document.getElementById('mtf-box').innerHTML=tfs.map(tf=>{
        const an=a.analyses[tf]; const bias=an?an.bias:'neutral';
        const pct=bias==='bullish'?75:bias==='bearish'?25:50;
        const col=bias==='bullish'?'var(--green)':bias==='bearish'?'var(--red)':'var(--text-muted)';
        const lbl=bias==='bullish'?'BULL':bias==='bearish'?'BEAR':'—';
        return '<div class="mtf-row"><span class="mtf-lbl">'+tf+'</span><div class="mtf-bar"><div class="mtf-fill" style="width:'+pct+'%;background:'+col+'"></div></div><span class="mtf-bias '+bias+'">'+lbl+'</span></div>';
      }).join('');
      // Confluence
      const sc=a.confluenceScore;
      document.getElementById('cm-fill').style.width=(sc*10)+'%';
      document.getElementById('cm-fill').style.background=sc>=7?'var(--green)':sc>=5?'var(--yellow)':'var(--red)';
      document.getElementById('cm-score').textContent=sc+'/10';
      // Signal
      const sb=document.getElementById('signal-box');
      if(a.signal){const s=a.signal;
        sb.innerHTML='<div class="sig-box '+s.direction+'"><div class="sig-head"><span class="sig-dir '+s.direction+'">'+s.direction.toUpperCase()+'</span><span class="sig-grade '+s.grade+'">'+s.grade+'</span></div><div class="sig-levels"><span class="sig-lbl">Entry</span><span class="sig-val">'+s.entry.toFixed(2)+'</span><span class="sig-lbl">SL</span><span class="sig-val" style="color:var(--red)">'+s.stopLoss.toFixed(2)+'</span><span class="sig-lbl">TP1</span><span class="sig-val" style="color:var(--green)">'+s.takeProfit1.toFixed(2)+'</span><span class="sig-lbl">TP2</span><span class="sig-val" style="color:var(--green)">'+s.takeProfit2.toFixed(2)+'</span><span class="sig-lbl">TP3</span><span class="sig-val" style="color:var(--green)">'+s.takeProfit3.toFixed(2)+'</span><span class="sig-lbl">R:R</span><span class="sig-val" style="color:var(--yellow)">1:'+s.riskRewardRatio.toFixed(1)+'</span></div></div>';
        showNotif(s);
        log('SIGNAL: '+s.direction.toUpperCase()+' @ '+s.entry.toFixed(2)+' RR 1:'+s.riskRewardRatio.toFixed(1),'signal');
      } else {
        sb.innerHTML='<div class="sig-box"><div style="text-align:center;color:var(--text-muted);padding:8px;">No signal ('+sc+'/10)</div></div>';
      }
      log('Analysis: '+a.overallBias+' | Score: '+sc+'/10',sc>=5?'signal':'warn');
    });

    // Paper trading events
    socket.on('paper-account',(acct)=>{
      document.getElementById('acct-bal').textContent='$'+acct.balance.toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:0});
      document.getElementById('acct-eq').textContent='$'+acct.equity.toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:0});
      document.getElementById('acct-wl').textContent=acct.wins+'W / '+acct.losses+'L';
      document.getElementById('acct-wr').textContent=(acct.winRate*100).toFixed(1)+'%';
      document.getElementById('acct-wr').className='acct-val '+(acct.winRate>=.5?'up':'down');
      const pnlSign=acct.totalPnL>=0?'+':'';
      document.getElementById('acct-pnl').textContent=pnlSign+'$'+acct.totalPnL.toFixed(0);
      document.getElementById('acct-pnl').className='acct-val '+(acct.totalPnL>=0?'up':'down');
      document.getElementById('acct-pf').textContent=acct.profitFactor===Infinity?'∞':acct.profitFactor.toFixed(2);
      // History
      const hist=document.getElementById('history-container');
      if(acct.trades&&acct.trades.length>0){
        hist.innerHTML=acct.trades.slice().reverse().slice(0,20).map(t=>{
          const pnl=t.pnlR||0; const cls=pnl>0?'win':'loss';
          return '<div class="th-item"><span class="th-dir '+t.direction+'">'+t.direction.toUpperCase().charAt(0)+'</span><span class="th-info">'+t.symbol.split(':')[1]+' • '+t.status+'</span><span class="th-pnl '+cls+'">'+(pnl>0?'+':'')+pnl.toFixed(2)+'R</span></div>';
        }).join('');
      }
    });

    socket.on('open-positions',(positions)=>{
      const c=document.getElementById('positions-container');
      if(!positions||positions.length===0){c.innerHTML='<div style="color:var(--text-muted);text-align:center;padding:8px;">No open positions</div>';return;}
      c.innerHTML=positions.map(p=>{
        const rpu=Math.abs(p.entry-p.stopLoss);
        const pnlR=p.direction==='long'?(lastPrice-p.entry)/rpu:(p.entry-lastPrice)/rpu;
        const pnlCls=pnlR>=0?'up':'down';
        return '<div class="pos-item '+p.direction+'"><div class="pos-head"><span class="pos-dir '+p.direction+'">'+p.direction.toUpperCase()+' '+p.symbol.split(':')[1]+'</span><button class="pos-close-btn" onclick="closePos(\\''+p.id+'\\')">✕ Close</button></div><div class="pos-detail">Entry: '+p.entry.toFixed(2)+' | SL: '+p.stopLoss.toFixed(2)+' | TP2: '+p.takeProfit2.toFixed(2)+'<br>PnL: <span style="color:var(--'+pnlCls+')">'+(pnlR>=0?'+':'')+pnlR.toFixed(2)+'R</span>'+(p.trailingStop?' | Trail: '+p.trailingStop.toFixed(2):'')+'</div></div>';
      }).join('');
    });

    socket.on('trade-opened',(t)=>{
      log('🟢 OPENED: '+t.direction.toUpperCase()+' '+t.symbol+' @ '+t.entry.toFixed(2),'trade');
      playSound(t.direction);
    });

    socket.on('trade-closed',(t)=>{
      const pnl=t.pnlR||0;
      const emoji=pnl>0?'✅':'❌';
      log(emoji+' CLOSED: '+t.direction.toUpperCase()+' '+t.symbol+' | '+(pnl>0?'+':'')+pnl.toFixed(2)+'R | '+t.status,'trade');
      playSound(pnl>0?'long':'short');
    });

    socket.on('news-update',(news)=>{
      const c=document.getElementById('news-container');
      if(!news||news.length===0){c.innerHTML='<div style="color:var(--text-muted);">No news available</div>';return;}
      const today=new Date().toISOString().split('T')[0];
      const todayNews=news.filter(n=>n.date===today||n.impact==='High').slice(0,15);
      c.innerHTML=todayNews.map(n=>'<div class="news-item"><div class="news-time"><span class="news-impact '+n.impact+'"></span>'+n.time+' • '+n.country+'</div><div class="news-title">'+n.title+(n.actual?' → <b>'+n.actual+'</b>':'')+'</div></div>').join('');
    });

    socket.on('status',(d)=>log(d.message,'info'));
    socket.on('error',(d)=>log('ERROR: '+d.message,'error'));
    socket.on('memory',(d)=>{});

    function closePos(id) { socket.emit('manual-close',{tradeId:id,price:lastPrice}); }

    function showNotif(signal) {
      const id=signal.direction+'_'+signal.entry.toFixed(0);
      if(id===lastSignalId) return; lastSignalId=id;
      const div=document.createElement('div');
      div.className='notif '+(signal.direction==='short'?'short':'');
      div.innerHTML='<button class="notif-x" onclick="this.parentElement.remove()">✕</button><div class="notif-title '+signal.direction+'">🎯 '+signal.direction.toUpperCase()+' ['+signal.grade+']</div><div class="notif-body">Entry: '+signal.entry.toFixed(2)+'<br>SL: '+signal.stopLoss.toFixed(2)+' | TP: '+signal.takeProfit2.toFixed(2)+'<br>R:R 1:'+signal.riskRewardRatio.toFixed(1)+'</div>';
      document.getElementById('notif-container').appendChild(div);
      setTimeout(()=>div.remove(),8000);
      playSound(signal.direction);
    }

    function log(msg,type='info') {
      const p=document.getElementById('log-panel');
      const t=new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      p.innerHTML+='<div class="log-line"><span class="log-t">'+t+'</span><span class="log-m '+type+'">'+msg+'</span></div>';
      p.scrollTop=p.scrollHeight;
    }

    // Auto-start
    setTimeout(()=>{ runAnalysis(); },1500);
    // Refresh news every 5 min
    setInterval(()=>socket.emit('request-news'),300000);
  </script>
</body>
</html>`;
}

export { app, httpServer };
