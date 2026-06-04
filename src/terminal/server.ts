/**
 * Trading Terminal Server v2.0
 * TradingView-style UI with multi-symbol monitoring & sound alerts
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { connectToTradingView, getMultiTimeframeData, subscribeToQuotes, RealtimeQuote } from '../data/tradingview-connector.js';
import { performMultiTimeframeAnalysis } from '../analysis/multi-timeframe.js';
import { loadMemory, getPerformanceSummary } from '../agent/memory.js';
import { assessPsychologyState } from '../knowledge/trading-in-the-zone.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Store active connections and quotes for watchlist
const activeQuotes: Record<string, RealtimeQuote> = {};

app.get('/', (req, res) => {
  res.send(getTerminalHTML());
});

io.on('connection', (socket) => {
  console.log('🖥️  Terminal client connected');

  const memory = loadMemory();
  socket.emit('memory', {
    performance: getPerformanceSummary(memory),
    lessons: memory.lessons.slice(0, 5).map(l => l.lesson),
    totalTrades: memory.performance.totalTrades
  });

  // Send current watchlist quotes
  socket.emit('watchlist-update', activeQuotes);

  let tvConnection: any = null;
  let unsubQuotes: (() => void) | null = null;
  let analysisInterval: NodeJS.Timeout | null = null;

  // Multi-symbol watchlist subscription
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
        socket.emit('watchlist-update', activeQuotes);
      });

      socket.emit('status', { message: `Monitoring ${symbols.length} symbols live` });
    } catch (err) {
      socket.emit('error', { message: `Watchlist connection failed: ${err}` });
    }
  });

  // Single symbol analysis
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
          }
        } catch (err) {
          console.error('Refresh error:', err);
        }
      }, 60000);

      socket.emit('status', { message: `Live monitoring ${symbol}` });
    } catch (err) {
      socket.emit('error', { message: `Analysis failed: ${err}` });
    }
  });

  socket.on('psychology-check', (state) => {
    const result = assessPsychologyState(state);
    socket.emit('psychology-result', result);
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
║        🤖 TRADING BOT AGENT TERMINAL v2.0                ║
╠══════════════════════════════════════════════════════════╣
║  http://localhost:${PORT}                                  ║
║                                                          ║
║  ✨ NEW: TradingView-style UI                            ║
║  ✨ NEW: Multi-symbol watchlist (BTC/ETH/GOLD)           ║
║  ✨ NEW: Sound alerts on signals                         ║
║  ✨ NEW: Timeframe switching                             ║
║  ✨ NEW: Clickable watchlist sidebar                     ║
╚══════════════════════════════════════════════════════════╝
  `);
});

function getTerminalHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Bot Agent</title>
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
      --accent-blue: #2962ff;
      --accent-green: #26a69a;
      --accent-red: #ef5350;
      --accent-yellow: #ff9800;
      --accent-purple: #ab47bc;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      overflow: hidden;
      height: 100vh;
    }

    /* === TOP TOOLBAR (TradingView style) === */
    .toolbar {
      height: 38px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 8px;
      gap: 2px;
    }
    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 6px;
      border-right: 1px solid var(--border);
      height: 100%;
    }
    .toolbar-group:last-child { border-right: none; }
    .tb-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .tb-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .tb-btn.active { background: var(--accent-blue); color: #fff; }
    .tb-btn.symbol-btn {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-primary);
      padding: 4px 12px;
    }
    .tb-btn.symbol-btn:hover { background: var(--bg-tertiary); }
    .tb-price {
      font-size: 18px;
      font-weight: 700;
      padding: 0 12px;
      letter-spacing: -0.5px;
    }
    .tb-price.up { color: var(--accent-green); }
    .tb-price.down { color: var(--accent-red); }
    .tb-change {
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .tb-change.up { color: var(--accent-green); background: rgba(38,166,154,0.1); }
    .tb-change.down { color: var(--accent-red); background: rgba(239,83,80,0.1); }
    .toolbar-spacer { flex: 1; }
    .alert-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .alert-toggle input { cursor: pointer; }

    /* === MAIN LAYOUT === */
    .main-layout {
      display: grid;
      grid-template-columns: 60px 220px 1fr 320px;
      grid-template-rows: 1fr 180px;
      height: calc(100vh - 38px);
    }

    /* === LEFT ICON BAR === */
    .icon-bar {
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 8px;
      gap: 4px;
      grid-row: 1 / 3;
    }
    .icon-btn {
      width: 42px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      transition: all 0.15s;
      border: none;
      background: none;
      color: var(--text-secondary);
    }
    .icon-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .icon-btn.active { background: var(--bg-tertiary); color: var(--accent-blue); }
    .icon-divider {
      width: 28px;
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }

    /* === WATCHLIST PANEL === */
    .watchlist-panel {
      background: var(--bg-primary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      grid-row: 1 / 3;
    }
    .watchlist-header {
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      background: var(--bg-primary);
      z-index: 1;
    }
    .watchlist-item {
      display: grid;
      grid-template-columns: 1fr auto;
      padding: 10px 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(42,46,57,0.5);
      transition: background 0.1s;
    }
    .watchlist-item:hover { background: var(--bg-secondary); }
    .watchlist-item.active { background: var(--bg-tertiary); border-left: 2px solid var(--accent-blue); }
    .wl-symbol {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .wl-name {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .wl-price {
      text-align: right;
      font-size: 13px;
      font-weight: 500;
    }
    .wl-price.up { color: var(--accent-green); }
    .wl-price.down { color: var(--accent-red); }
    .wl-change {
      text-align: right;
      font-size: 10px;
      margin-top: 2px;
    }
    .wl-change.up { color: var(--accent-green); }
    .wl-change.down { color: var(--accent-red); }

    /* === CHART AREA === */
    .chart-area {
      background: var(--bg-primary);
      position: relative;
      overflow: hidden;
    }
    #chart { width: 100%; height: 100%; }

    /* === RIGHT PANEL (Analysis) === */
    .analysis-panel {
      background: var(--bg-primary);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      grid-row: 1 / 3;
    }
    .ap-section {
      border-bottom: 1px solid var(--border);
      padding: 12px;
    }
    .ap-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    /* MTF Bias Grid */
    .mtf-row {
      display: flex;
      align-items: center;
      padding: 5px 0;
      border-bottom: 1px solid rgba(42,46,57,0.3);
    }
    .mtf-row:last-child { border-bottom: none; }
    .mtf-tf-label {
      width: 36px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .mtf-bar {
      flex: 1;
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
      margin: 0 8px;
    }
    .mtf-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
    .mtf-bias-label {
      width: 60px;
      text-align: right;
      font-size: 10px;
      font-weight: 600;
    }
    .mtf-bias-label.bullish { color: var(--accent-green); }
    .mtf-bias-label.bearish { color: var(--accent-red); }
    .mtf-bias-label.neutral { color: var(--accent-yellow); }

    /* Signal Card */
    .signal-box {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 12px;
      border: 1px solid var(--border);
    }
    .signal-box.long { border-top: 3px solid var(--accent-green); }
    .signal-box.short { border-top: 3px solid var(--accent-red); }
    .signal-box.none { border-top: 3px solid var(--text-muted); }
    .signal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .signal-dir {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 1px;
    }
    .signal-dir.long { color: var(--accent-green); }
    .signal-dir.short { color: var(--accent-red); }
    .signal-grade {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .signal-grade.A { background: var(--accent-green); color: #fff; }
    .signal-grade.B { background: var(--accent-blue); color: #fff; }
    .signal-grade.C { background: var(--accent-yellow); color: #000; }
    .signal-levels {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      font-size: 11px;
    }
    .sl-label { color: var(--text-muted); }
    .sl-value { font-weight: 600; text-align: right; }
    .sl-value.green { color: var(--accent-green); }
    .sl-value.red { color: var(--accent-red); }
    .sl-value.yellow { color: var(--accent-yellow); }

    /* Confluence meter */
    .confluence-meter {
      margin-top: 12px;
    }
    .cm-bar {
      height: 10px;
      background: var(--bg-tertiary);
      border-radius: 5px;
      overflow: hidden;
    }
    .cm-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.5s ease, background 0.3s;
    }
    .cm-label {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Reasoning */
    .reasoning-item {
      font-size: 11px;
      padding: 4px 0;
      line-height: 1.5;
      color: var(--text-secondary);
      border-bottom: 1px solid rgba(42,46,57,0.3);
    }
    .reasoning-item:last-child { border-bottom: none; }

    /* === BOTTOM LOG PANEL === */
    .log-panel {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      overflow-y: auto;
      padding: 8px 12px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11px;
    }
    .log-line {
      padding: 2px 0;
      display: flex;
      gap: 8px;
    }
    .log-time { color: var(--text-muted); min-width: 70px; }
    .log-msg { color: var(--text-secondary); }
    .log-msg.info { color: var(--accent-blue); }
    .log-msg.signal { color: var(--accent-green); font-weight: 600; }
    .log-msg.warn { color: var(--accent-yellow); }
    .log-msg.error { color: var(--accent-red); }

    /* === STATUS BAR === */
    .status-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 22px;
      background: var(--bg-tertiary);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 10px;
      color: var(--text-muted);
      justify-content: space-between;
      z-index: 100;
    }
    .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
    }
    .status-dot.on { background: var(--accent-green); box-shadow: 0 0 4px var(--accent-green); }
    .status-dot.off { background: var(--accent-red); }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--bg-hover); }

    /* Notification popup */
    .signal-notification {
      position: fixed;
      top: 50px;
      right: 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--accent-green);
      border-radius: 12px;
      padding: 16px 20px;
      z-index: 9999;
      animation: slideIn 0.3s ease;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      max-width: 300px;
    }
    .signal-notification.short { border-color: var(--accent-red); }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .notif-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
    .notif-title.long { color: var(--accent-green); }
    .notif-title.short { color: var(--accent-red); }
    .notif-body { font-size: 11px; color: var(--text-secondary); line-height: 1.6; }
    .notif-close {
      position: absolute; top: 8px; right: 12px;
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 16px;
    }
  </style>
</head>
<body>
  <!-- TOOLBAR -->
  <div class="toolbar">
    <div class="toolbar-group">
      <button class="tb-btn symbol-btn" id="active-symbol" onclick="showSymbolSearch()">BTCUSDT</button>
    </div>
    <div class="toolbar-group" id="tf-buttons">
      <button class="tb-btn" data-tf="M1" onclick="switchTF('M1')">1m</button>
      <button class="tb-btn" data-tf="M5" onclick="switchTF('M5')">5m</button>
      <button class="tb-btn" data-tf="M15" onclick="switchTF('M15')">15m</button>
      <button class="tb-btn active" data-tf="H1" onclick="switchTF('H1')">1H</button>
      <button class="tb-btn" data-tf="H4" onclick="switchTF('H4')">4H</button>
      <button class="tb-btn" data-tf="D" onclick="switchTF('D')">1D</button>
    </div>
    <div class="toolbar-group">
      <span class="tb-price" id="tb-price">--</span>
      <span class="tb-change" id="tb-change">--</span>
    </div>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-group">
      <div class="alert-toggle">
        <input type="checkbox" id="sound-toggle" checked>
        <label for="sound-toggle">🔊 Sound Alerts</label>
      </div>
    </div>
    <div class="toolbar-group">
      <button class="tb-btn" onclick="runAnalysis()" style="color:var(--accent-green);font-weight:700;">▶ Analyze</button>
    </div>
  </div>

  <!-- MAIN LAYOUT -->
  <div class="main-layout">
    <!-- Icon Bar -->
    <div class="icon-bar">
      <button class="icon-btn active" title="Watchlist" onclick="togglePanel('watchlist')">📋</button>
      <button class="icon-btn" title="Analysis" onclick="togglePanel('analysis')">📊</button>
      <div class="icon-divider"></div>
      <button class="icon-btn" title="Alerts" onclick="togglePanel('alerts')">🔔</button>
      <button class="icon-btn" title="Brain/Lessons" onclick="togglePanel('brain')">🧠</button>
      <div class="icon-divider"></div>
      <button class="icon-btn" title="Performance" onclick="showPerformance()">📈</button>
    </div>

    <!-- Watchlist -->
    <div class="watchlist-panel" id="watchlist-panel">
      <div class="watchlist-header">
        <span>Watchlist</span>
        <span style="color:var(--text-muted);">Live</span>
      </div>
      <div id="watchlist-items"></div>
    </div>

    <!-- Chart -->
    <div class="chart-area">
      <div id="chart"></div>
    </div>

    <!-- Analysis Panel -->
    <div class="analysis-panel" id="analysis-panel">
      <div class="ap-section">
        <div class="ap-title">📊 Multi-Timeframe</div>
        <div id="mtf-container">
          <div class="mtf-row"><span class="mtf-tf-label">D</span><div class="mtf-bar"><div class="mtf-bar-fill" style="width:50%;background:var(--text-muted)"></div></div><span class="mtf-bias-label neutral">—</span></div>
          <div class="mtf-row"><span class="mtf-tf-label">H4</span><div class="mtf-bar"><div class="mtf-bar-fill" style="width:50%;background:var(--text-muted)"></div></div><span class="mtf-bias-label neutral">—</span></div>
          <div class="mtf-row"><span class="mtf-tf-label">H1</span><div class="mtf-bar"><div class="mtf-bar-fill" style="width:50%;background:var(--text-muted)"></div></div><span class="mtf-bias-label neutral">—</span></div>
          <div class="mtf-row"><span class="mtf-tf-label">M15</span><div class="mtf-bar"><div class="mtf-bar-fill" style="width:50%;background:var(--text-muted)"></div></div><span class="mtf-bias-label neutral">—</span></div>
          <div class="mtf-row"><span class="mtf-tf-label">M5</span><div class="mtf-bar"><div class="mtf-bar-fill" style="width:50%;background:var(--text-muted)"></div></div><span class="mtf-bias-label neutral">—</span></div>
        </div>
        <div class="confluence-meter">
          <div class="cm-bar"><div class="cm-fill" id="cm-fill" style="width:0%;background:var(--text-muted)"></div></div>
          <div class="cm-label"><span>Confluence</span><span id="cm-score">0/10</span></div>
        </div>
      </div>

      <div class="ap-section">
        <div class="ap-title">🎯 Signal</div>
        <div id="signal-box">
          <div class="signal-box none">
            <div style="text-align:center;color:var(--text-muted);padding:10px;">Click Analyze to scan</div>
          </div>
        </div>
      </div>

      <div class="ap-section">
        <div class="ap-title">🧠 Reasoning</div>
        <div id="reasoning-container">
          <div class="reasoning-item">Awaiting analysis...</div>
        </div>
      </div>

      <div class="ap-section">
        <div class="ap-title">📚 Lessons</div>
        <div id="lessons-container">
          <div class="reasoning-item">Loading knowledge base...</div>
        </div>
      </div>
    </div>

    <!-- Log Panel -->
    <div class="log-panel" id="log-panel">
      <div class="log-line"><span class="log-time">SYSTEM</span><span class="log-msg info">Trading Bot Agent v2.0 initialized</span></div>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <div><span class="status-dot off" id="status-dot"></span><span id="status-text">Disconnected</span></div>
    <div id="status-msg">Ready</div>
    <div>Multi-Symbol • Real-Time • TradingView WS</div>
  </div>

  <!-- Notification Container -->
  <div id="notification-container"></div>

  <script>
    // === STATE ===
    const socket = io();
    let chart, candleSeries, volumeSeries;
    let currentSymbol = 'BINANCE:BTCUSDT';
    let currentTF = 'H1';
    let candleData = {};
    let soundEnabled = true;
    let lastSignalId = null;

    const WATCHLIST = [
      { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin', short: 'BTC/USDT' },
      { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum', short: 'ETH/USDT' },
      { symbol: 'TVC:GOLD', name: 'Gold Spot', short: 'XAU/USD' },
      { symbol: 'BINANCE:SOLUSDT', name: 'Solana', short: 'SOL/USDT' },
      { symbol: 'BINANCE:BNBUSDT', name: 'BNB', short: 'BNB/USDT' },
      { symbol: 'FX:EURUSD', name: 'Euro/Dollar', short: 'EUR/USD' },
    ];

    // === SOUND SYSTEM ===
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    function initAudio() {
      if (!audioCtx) audioCtx = new AudioCtx();
    }
    function playSignalSound(type) {
      if (!soundEnabled) return;
      initAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (type === 'long') {
        osc.frequency.setValueAtTime(523, audioCtx.currentTime); // C5
        osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(784, audioCtx.currentTime + 0.2); // G5
      } else {
        osc.frequency.setValueAtTime(784, audioCtx.currentTime); // G5
        osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(523, audioCtx.currentTime + 0.2); // C5
      }
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.4);
    }
    function playAlertBeep() {
      if (!soundEnabled) return;
      initAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    }

    document.getElementById('sound-toggle').addEventListener('change', (e) => {
      soundEnabled = e.target.checked;
      initAudio();
    });

    // === CHART INIT ===
    function initChart() {
      const container = document.getElementById('chart');
      chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { labelBackgroundColor: '#2962ff' }, horzLine: { labelBackgroundColor: '#2962ff' } },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#2a2e39' }
      });
      candleSeries = chart.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350'
      });
      volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.85, bottom: 0 }
      });

      new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }).observe(container);
    }
    initChart();

    // === WATCHLIST ===
    function renderWatchlist() {
      const container = document.getElementById('watchlist-items');
      container.innerHTML = WATCHLIST.map(item => {
        const isActive = item.symbol === currentSymbol ? ' active' : '';
        return \`<div class="watchlist-item\${isActive}" onclick="selectSymbol('\${item.symbol}')">
          <div>
            <div class="wl-symbol">\${item.short}</div>
            <div class="wl-name">\${item.name}</div>
          </div>
          <div>
            <div class="wl-price" id="wl-price-\${item.symbol.replace(/[:.]/g,'-')}">--</div>
            <div class="wl-change" id="wl-change-\${item.symbol.replace(/[:.]/g,'-')}">--</div>
          </div>
        </div>\`;
      }).join('');
    }
    renderWatchlist();

    function selectSymbol(symbol) {
      currentSymbol = symbol;
      const item = WATCHLIST.find(w => w.symbol === symbol);
      document.getElementById('active-symbol').textContent = item ? item.short : symbol;
      renderWatchlist();
      runAnalysis();
    }

    // === TIMEFRAME SWITCH ===
    function switchTF(tf) {
      currentTF = tf;
      document.querySelectorAll('#tf-buttons .tb-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
      });
      if (candleData[tf]) {
        updateChart(candleData[tf]);
      }
    }

    function updateChart(candles) {
      if (!candles || candles.length === 0) return;
      const cData = candles.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
      const vData = candles.map(c => ({ time: c.timestamp, value: c.volume || 0, color: c.close >= c.open ? 'rgba(38,166,154,0.3)' : 'rgba(239,83,80,0.3)' }));
      candleSeries.setData(cData);
      volumeSeries.setData(vData);
      chart.timeScale().fitContent();
    }

    // === ANALYSIS ===
    function runAnalysis() {
      log('Analyzing ' + currentSymbol + '...', 'info');
      socket.emit('request-analysis', { symbol: currentSymbol });
    }

    // === NOTIFICATION ===
    function showNotification(signal) {
      const id = signal.direction + '_' + signal.entry.toFixed(0);
      if (id === lastSignalId) return;
      lastSignalId = id;

      const container = document.getElementById('notification-container');
      const div = document.createElement('div');
      div.className = 'signal-notification ' + (signal.direction === 'short' ? 'short' : '');
      div.innerHTML = \`
        <button class="notif-close" onclick="this.parentElement.remove()">✕</button>
        <div class="notif-title \${signal.direction}">🎯 \${signal.direction.toUpperCase()} SIGNAL [\${signal.grade}]</div>
        <div class="notif-body">
          Entry: \${signal.entry.toFixed(2)}<br>
          SL: \${signal.stopLoss.toFixed(2)} | TP: \${signal.takeProfit2.toFixed(2)}<br>
          R:R = 1:\${signal.riskRewardRatio.toFixed(1)}
        </div>
      \`;
      container.appendChild(div);
      setTimeout(() => div.remove(), 10000);

      playSignalSound(signal.direction);
    }

    // === LOGGING ===
    function log(msg, type = 'info') {
      const panel = document.getElementById('log-panel');
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      panel.innerHTML += \`<div class="log-line"><span class="log-time">\${time}</span><span class="log-msg \${type}">\${msg}</span></div>\`;
      panel.scrollTop = panel.scrollHeight;
    }

    // === SOCKET EVENTS ===
    socket.on('connect', () => {
      document.getElementById('status-dot').className = 'status-dot on';
      document.getElementById('status-text').textContent = 'Connected';
      log('Connected to server', 'info');
      // Subscribe watchlist
      socket.emit('subscribe-watchlist', { symbols: WATCHLIST.map(w => w.symbol) });
    });

    socket.on('disconnect', () => {
      document.getElementById('status-dot').className = 'status-dot off';
      document.getElementById('status-text').textContent = 'Disconnected';
    });

    socket.on('status', (data) => {
      document.getElementById('status-msg').textContent = data.message;
      log(data.message, 'info');
    });

    socket.on('quote', (quote) => {
      // Update toolbar if current symbol
      if (quote.symbol === currentSymbol || quote.symbol.includes(currentSymbol.split(':')[1])) {
        const priceEl = document.getElementById('tb-price');
        const changeEl = document.getElementById('tb-change');
        priceEl.textContent = quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        priceEl.className = 'tb-price ' + (quote.changePercent >= 0 ? 'up' : 'down');
        const sign = quote.changePercent >= 0 ? '+' : '';
        changeEl.textContent = sign + quote.changePercent.toFixed(2) + '%';
        changeEl.className = 'tb-change ' + (quote.changePercent >= 0 ? 'up' : 'down');
      }
      // Update watchlist
      const safeId = quote.symbol.replace(/[:.]/g, '-');
      const priceEl = document.getElementById('wl-price-' + safeId);
      const changeEl = document.getElementById('wl-change-' + safeId);
      if (priceEl) {
        priceEl.textContent = quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        priceEl.className = 'wl-price ' + (quote.changePercent >= 0 ? 'up' : 'down');
      }
      if (changeEl) {
        const s = quote.changePercent >= 0 ? '+' : '';
        changeEl.textContent = s + quote.changePercent.toFixed(2) + '%';
        changeEl.className = 'wl-change ' + (quote.changePercent >= 0 ? 'up' : 'down');
      }
    });

    socket.on('candles', (data) => {
      candleData = data.timeframes;
      if (candleData[currentTF]) {
        updateChart(candleData[currentTF]);
        log('Chart updated: ' + Object.keys(candleData).join(', '), 'info');
      } else {
        // Fallback to H1 or first available
        const fallback = candleData['H1'] || candleData[Object.keys(candleData)[0]];
        if (fallback) updateChart(fallback);
      }
    });

    socket.on('analysis', (analysis) => {
      // MTF
      const tfs = ['D', 'H4', 'H1', 'M15', 'M5'];
      const mtfContainer = document.getElementById('mtf-container');
      mtfContainer.innerHTML = tfs.map(tf => {
        const a = analysis.analyses[tf];
        const bias = a ? a.bias : 'neutral';
        const pct = bias === 'bullish' ? 75 : bias === 'bearish' ? 25 : 50;
        const color = bias === 'bullish' ? 'var(--accent-green)' : bias === 'bearish' ? 'var(--accent-red)' : 'var(--text-muted)';
        const label = bias === 'bullish' ? 'BULL' : bias === 'bearish' ? 'BEAR' : '—';
        return \`<div class="mtf-row">
          <span class="mtf-tf-label">\${tf}</span>
          <div class="mtf-bar"><div class="mtf-bar-fill" style="width:\${pct}%;background:\${color}"></div></div>
          <span class="mtf-bias-label \${bias}">\${label}</span>
        </div>\`;
      }).join('');

      // Confluence
      const score = analysis.confluenceScore;
      const cmFill = document.getElementById('cm-fill');
      cmFill.style.width = (score * 10) + '%';
      cmFill.style.background = score >= 7 ? 'var(--accent-green)' : score >= 5 ? 'var(--accent-yellow)' : 'var(--accent-red)';
      document.getElementById('cm-score').textContent = score + '/10';

      // Signal
      const signalBox = document.getElementById('signal-box');
      if (analysis.signal) {
        const s = analysis.signal;
        signalBox.innerHTML = \`<div class="signal-box \${s.direction}">
          <div class="signal-header">
            <span class="signal-dir \${s.direction}">\${s.direction.toUpperCase()}</span>
            <span class="signal-grade \${s.grade}">\${s.grade}</span>
          </div>
          <div class="signal-levels">
            <span class="sl-label">Entry</span><span class="sl-value">\${s.entry.toFixed(2)}</span>
            <span class="sl-label">Stop Loss</span><span class="sl-value red">\${s.stopLoss.toFixed(2)}</span>
            <span class="sl-label">TP1</span><span class="sl-value green">\${s.takeProfit1.toFixed(2)}</span>
            <span class="sl-label">TP2</span><span class="sl-value green">\${s.takeProfit2.toFixed(2)}</span>
            <span class="sl-label">TP3</span><span class="sl-value green">\${s.takeProfit3.toFixed(2)}</span>
            <span class="sl-label">R:R</span><span class="sl-value yellow">1:\${s.riskRewardRatio.toFixed(1)}</span>
            <span class="sl-label">Setup</span><span class="sl-value">\${s.setup}</span>
          </div>
        </div>\`;
        showNotification(s);
        log('🎯 SIGNAL: ' + s.direction.toUpperCase() + ' @ ' + s.entry.toFixed(2) + ' | RR 1:' + s.riskRewardRatio.toFixed(1), 'signal');
      } else {
        signalBox.innerHTML = \`<div class="signal-box none">
          <div style="text-align:center;padding:10px;">
            <div style="color:var(--text-muted);font-size:12px;">No Signal</div>
            <div style="color:var(--text-muted);font-size:11px;margin-top:4px;">Confluence \${score}/10 (need 5+)</div>
            <div style="color:var(--accent-yellow);font-size:11px;margin-top:4px;">\${analysis.overallBias}</div>
          </div>
        </div>\`;
      }

      // Reasoning
      const reasoningContainer = document.getElementById('reasoning-container');
      reasoningContainer.innerHTML = analysis.reasoning.map(r => \`<div class="reasoning-item">\${r}</div>\`).join('');

      log('Analysis: ' + analysis.overallBias + ' | Score: ' + score + '/10', score >= 5 ? 'signal' : 'warn');
    });

    socket.on('memory', (data) => {
      const container = document.getElementById('lessons-container');
      container.innerHTML = data.lessons.map(l => \`<div class="reasoning-item">• \${l}</div>\`).join('');
    });

    socket.on('error', (data) => { log('ERROR: ' + data.message, 'error'); });

    // === HELPERS ===
    function togglePanel(panel) {
      // Simple toggle logic (can expand)
      playAlertBeep();
    }
    function showPerformance() { playAlertBeep(); log('Performance dashboard coming soon', 'warn'); }
    function showSymbolSearch() {
      const sym = prompt('Enter symbol (e.g. BINANCE:BTCUSDT, FX:EURUSD, TVC:GOLD):');
      if (sym) selectSymbol(sym);
    }

    // Auto-start
    setTimeout(() => { runAnalysis(); }, 1500);
  </script>
</body>
</html>`;
}

export { app, httpServer };
