/**
 * Trading Terminal Server
 * Real-time web-based terminal with TradingView chart integration
 * Shows live prices, multi-timeframe analysis, and signals
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { connectToTradingView, getMultiTimeframeData, subscribeToQuotes } from '../data/tradingview-connector.js';
import { performMultiTimeframeAnalysis } from '../analysis/multi-timeframe.js';
import { loadMemory, getPerformanceSummary, getRelevantLessons } from '../agent/memory.js';
import { assessPsychologyState, ZONE_RULES } from '../knowledge/trading-in-the-zone.js';
import { NEWS_TRADING_RULES } from '../knowledge/forex-factory-calendar.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Serve the terminal HTML
app.get('/', (req, res) => {
  res.send(getTerminalHTML());
});

// API endpoint for analysis
app.get('/api/analyze/:symbol', async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol);
    res.json({ status: 'analyzing', symbol, message: 'Check WebSocket for real-time updates' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// WebSocket connections
io.on('connection', (socket) => {
  console.log('🖥️  Terminal client connected');
  
  const memory = loadMemory();
  socket.emit('memory', {
    performance: getPerformanceSummary(memory),
    lessons: memory.lessons.slice(0, 5).map(l => l.lesson),
    totalTrades: memory.performance.totalTrades
  });

  socket.on('request-analysis', async (data) => {
    const { symbol } = data;
    socket.emit('status', { message: `Connecting to TradingView for ${symbol}...` });
    
    try {
      const connection = await connectToTradingView();
      socket.emit('status', { message: `Connected! Fetching multi-timeframe data...` });
      
      // Subscribe to real-time quotes
      const unsubQuotes = subscribeToQuotes(connection, [symbol], (quote) => {
        socket.emit('quote', quote);
      });
      
      // Fetch MTF data
      const mtfData = await getMultiTimeframeData(connection, symbol, 200);
      socket.emit('status', { message: `Data received. Running analysis...` });
      
      // Run analysis
      const analysis = performMultiTimeframeAnalysis(mtfData, symbol);
      socket.emit('analysis', analysis);
      
      // Send candle data for charting
      socket.emit('candles', {
        symbol,
        timeframes: Object.fromEntries(
          Object.entries(mtfData).map(([tf, candles]) => [tf, candles.slice(-100)])
        )
      });
      
      // Keep connection alive for real-time updates
      const interval = setInterval(async () => {
        try {
          if (connection.isConnected()) {
            // Re-fetch M5 and M15 for fresh analysis
            const freshM5 = mtfData['M5'] || [];
            const freshAnalysis = performMultiTimeframeAnalysis(mtfData, symbol);
            socket.emit('analysis', freshAnalysis);
          }
        } catch (err) {
          console.error('Update error:', err);
        }
      }, 60000); // Update every minute
      
      socket.on('disconnect', () => {
        clearInterval(interval);
        unsubQuotes();
        connection.close().catch(() => {});
        console.log('🖥️  Terminal client disconnected');
      });
      
    } catch (err) {
      socket.emit('error', { message: `Connection failed: ${err}` });
    }
  });
  
  socket.on('psychology-check', (state) => {
    const result = assessPsychologyState(state);
    socket.emit('psychology-result', result);
  });
});

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           🤖 TRADING BOT AGENT TERMINAL                  ║
║══════════════════════════════════════════════════════════║
║  Server running at: http://localhost:${PORT}               ║
║                                                          ║
║  Features:                                               ║
║  • Real-time TradingView price data                      ║
║  • Multi-timeframe analysis (D/H4/H1/M15/M5)           ║
║  • Book-based knowledge system                           ║
║  • Signal generation with confluence scoring             ║
║  • Psychology state monitoring                           ║
║  • Trade memory & performance tracking                   ║
╚══════════════════════════════════════════════════════════╝
  `);
});

function getTerminalHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Bot Agent Terminal</title>
  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #0a0e17;
      color: #e1e5eb;
      overflow-x: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%);
      border-bottom: 1px solid #2d333b;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 16px;
      color: #58a6ff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .price-display {
      font-size: 24px;
      font-weight: bold;
      color: #f0f6fc;
    }
    .price-change { font-size: 14px; margin-left: 10px; }
    .price-change.up { color: #3fb950; }
    .price-change.down { color: #f85149; }
    
    .grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 60px);
      gap: 1px;
      background: #21262d;
    }
    
    .chart-panel {
      background: #0d1117;
      position: relative;
    }
    #chart { width: 100%; height: 100%; }
    
    .sidebar {
      background: #0d1117;
      overflow-y: auto;
      border-left: 1px solid #21262d;
      display: flex;
      flex-direction: column;
    }
    
    .panel {
      border-bottom: 1px solid #21262d;
      padding: 12px;
    }
    .panel-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #8b949e;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .signal-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px;
      margin-top: 8px;
    }
    .signal-card.bullish { border-left: 3px solid #3fb950; }
    .signal-card.bearish { border-left: 3px solid #f85149; }
    .signal-card.neutral { border-left: 3px solid #d29922; }
    
    .signal-direction {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 6px;
    }
    .signal-direction.long { color: #3fb950; }
    .signal-direction.short { color: #f85149; }
    
    .signal-detail {
      font-size: 11px;
      color: #8b949e;
      line-height: 1.8;
    }
    .signal-detail span { color: #e1e5eb; }
    
    .mtf-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
    }
    .mtf-item {
      text-align: center;
      padding: 6px 4px;
      border-radius: 4px;
      font-size: 10px;
      background: #161b22;
    }
    .mtf-item.bullish { background: #0d2818; color: #3fb950; }
    .mtf-item.bearish { background: #2d1117; color: #f85149; }
    .mtf-item.neutral { background: #2d2200; color: #d29922; }
    .mtf-label { font-weight: bold; font-size: 11px; }
    
    .confluence-bar {
      height: 8px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
      margin: 8px 0;
    }
    .confluence-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }
    
    .log-panel {
      background: #0d1117;
      border-top: 1px solid #21262d;
      grid-column: 1 / -1;
      max-height: 200px;
      overflow-y: auto;
      padding: 8px 12px;
      font-size: 11px;
    }
    .log-entry {
      padding: 2px 0;
      border-bottom: 1px solid #161b22;
      line-height: 1.6;
    }
    .log-time { color: #484f58; }
    .log-info { color: #58a6ff; }
    .log-warn { color: #d29922; }
    .log-signal { color: #3fb950; }
    .log-error { color: #f85149; }
    
    .controls {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      background: #161b22;
      border-bottom: 1px solid #21262d;
    }
    .controls input {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      color: #e1e5eb;
      padding: 6px 10px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
    }
    .controls button {
      background: #238636;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: bold;
    }
    .controls button:hover { background: #2ea043; }
    
    .reasoning-list {
      list-style: none;
      font-size: 11px;
      line-height: 1.8;
    }
    .reasoning-list li { padding: 2px 0; }
    
    .status-bar {
      padding: 4px 12px;
      background: #161b22;
      font-size: 10px;
      color: #484f58;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #21262d;
    }
    .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 4px;
    }
    .status-dot.connected { background: #3fb950; }
    .status-dot.disconnected { background: #f85149; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Trading Bot Agent</h1>
    <div>
      <span class="price-display" id="price">--</span>
      <span class="price-change" id="price-change">--</span>
    </div>
  </div>
  
  <div class="controls">
    <input type="text" id="symbol-input" value="BINANCE:BTCUSDT" placeholder="Enter symbol (e.g. BINANCE:BTCUSDT)">
    <button onclick="startAnalysis()">🔍 Analyze</button>
  </div>
  
  <div class="grid">
    <div class="chart-panel">
      <div id="chart"></div>
    </div>
    
    <div class="sidebar">
      <div class="panel">
        <div class="panel-title">📊 Multi-Timeframe Bias</div>
        <div class="mtf-grid" id="mtf-grid">
          <div class="mtf-item neutral"><div class="mtf-label">D</div><div>--</div></div>
          <div class="mtf-item neutral"><div class="mtf-label">H4</div><div>--</div></div>
          <div class="mtf-item neutral"><div class="mtf-label">H1</div><div>--</div></div>
          <div class="mtf-item neutral"><div class="mtf-label">M15</div><div>--</div></div>
          <div class="mtf-item neutral"><div class="mtf-label">M5</div><div>--</div></div>
        </div>
        <div class="confluence-bar">
          <div class="confluence-fill" id="confluence-bar" style="width: 0%; background: #484f58;"></div>
        </div>
        <div style="font-size:11px; color:#8b949e;">Confluence: <span id="confluence-score">0</span>/10</div>
      </div>
      
      <div class="panel">
        <div class="panel-title">🎯 Signal</div>
        <div id="signal-container">
          <div class="signal-card neutral">
            <div style="color:#d29922; font-size:12px;">Waiting for analysis...</div>
          </div>
        </div>
      </div>
      
      <div class="panel">
        <div class="panel-title">🧠 Reasoning</div>
        <ul class="reasoning-list" id="reasoning-list">
          <li>Start an analysis to see reasoning</li>
        </ul>
      </div>
      
      <div class="panel">
        <div class="panel-title">📚 Active Lessons</div>
        <ul class="reasoning-list" id="lessons-list">
          <li>Loading knowledge base...</li>
        </ul>
      </div>
    </div>
    
    <div class="log-panel" id="log-panel">
      <div class="log-entry"><span class="log-time">[BOOT]</span> <span class="log-info">Trading Bot Agent initialized. Knowledge base loaded.</span></div>
    </div>
  </div>
  
  <div class="status-bar">
    <span><span class="status-dot disconnected" id="status-dot"></span><span id="status-text">Disconnected</span></span>
    <span id="status-message">Ready</span>
  </div>

  <script>
    const socket = io();
    let chart, candleSeries;
    
    // Initialize chart
    function initChart() {
      const container = document.getElementById('chart');
      chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
        grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#21262d', timeVisible: true },
        rightPriceScale: { borderColor: '#21262d' }
      });
      candleSeries = chart.addCandlestickSeries({
        upColor: '#3fb950', downColor: '#f85149',
        borderUpColor: '#3fb950', borderDownColor: '#f85149',
        wickUpColor: '#3fb950', wickDownColor: '#f85149'
      });
      window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      });
    }
    initChart();
    
    function log(msg, type = 'info') {
      const panel = document.getElementById('log-panel');
      const time = new Date().toLocaleTimeString();
      panel.innerHTML += '<div class="log-entry"><span class="log-time">[' + time + ']</span> <span class="log-' + type + '">' + msg + '</span></div>';
      panel.scrollTop = panel.scrollHeight;
    }
    
    function startAnalysis() {
      const symbol = document.getElementById('symbol-input').value.trim();
      if (!symbol) return;
      log('Requesting analysis for ' + symbol + '...', 'info');
      socket.emit('request-analysis', { symbol });
    }
    
    // Socket events
    socket.on('connect', () => {
      document.getElementById('status-dot').className = 'status-dot connected';
      document.getElementById('status-text').textContent = 'Connected';
      log('Connected to server', 'info');
    });
    
    socket.on('disconnect', () => {
      document.getElementById('status-dot').className = 'status-dot disconnected';
      document.getElementById('status-text').textContent = 'Disconnected';
    });
    
    socket.on('status', (data) => {
      document.getElementById('status-message').textContent = data.message;
      log(data.message, 'info');
    });
    
    socket.on('quote', (quote) => {
      document.getElementById('price').textContent = quote.price.toFixed(2);
      const changeEl = document.getElementById('price-change');
      const sign = quote.changePercent >= 0 ? '+' : '';
      changeEl.textContent = sign + quote.changePercent.toFixed(2) + '%';
      changeEl.className = 'price-change ' + (quote.changePercent >= 0 ? 'up' : 'down');
    });
    
    socket.on('candles', (data) => {
      const h1Candles = data.timeframes['H1'] || data.timeframes['M15'] || [];
      if (h1Candles.length > 0) {
        const chartData = h1Candles.map(c => ({
          time: c.timestamp,
          open: c.open, high: c.high, low: c.low, close: c.close
        }));
        candleSeries.setData(chartData);
        chart.timeScale().fitContent();
        log('Chart loaded: ' + h1Candles.length + ' candles (H1)', 'info');
      }
    });
    
    socket.on('analysis', (analysis) => {
      // Update MTF grid
      const mtfGrid = document.getElementById('mtf-grid');
      const tfs = ['D', 'H4', 'H1', 'M15', 'M5'];
      mtfGrid.innerHTML = tfs.map(tf => {
        const a = analysis.analyses[tf];
        const bias = a ? a.bias : 'neutral';
        const emoji = bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '—';
        return '<div class="mtf-item ' + bias + '"><div class="mtf-label">' + tf + '</div><div>' + emoji + '</div></div>';
      }).join('');
      
      // Confluence
      const score = analysis.confluenceScore;
      const bar = document.getElementById('confluence-bar');
      bar.style.width = (score * 10) + '%';
      bar.style.background = score >= 7 ? '#3fb950' : score >= 5 ? '#d29922' : '#f85149';
      document.getElementById('confluence-score').textContent = score;
      
      // Signal
      const signalContainer = document.getElementById('signal-container');
      if (analysis.signal) {
        const s = analysis.signal;
        const dirClass = s.direction === 'long' ? 'bullish' : 'bearish';
        signalContainer.innerHTML = '<div class="signal-card ' + dirClass + '">' +
          '<div class="signal-direction ' + s.direction + '">' + s.direction.toUpperCase() + ' [' + s.grade + ']</div>' +
          '<div class="signal-detail">' +
          'Entry: <span>' + s.entry.toFixed(2) + '</span><br>' +
          'Stop Loss: <span style="color:#f85149">' + s.stopLoss.toFixed(2) + '</span><br>' +
          'TP1: <span style="color:#3fb950">' + s.takeProfit1.toFixed(2) + '</span><br>' +
          'TP2: <span style="color:#3fb950">' + s.takeProfit2.toFixed(2) + '</span><br>' +
          'TP3: <span style="color:#3fb950">' + s.takeProfit3.toFixed(2) + '</span><br>' +
          'R:R = 1:' + s.riskRewardRatio.toFixed(1) + '<br>' +
          'Setup: <span>' + s.setup + '</span><br>' +
          'Invalidation: <span style="color:#d29922">' + s.invalidation + '</span>' +
          '</div></div>';
        log('SIGNAL: ' + s.direction.toUpperCase() + ' @ ' + s.entry.toFixed(2) + ' | SL: ' + s.stopLoss.toFixed(2) + ' | TP: ' + s.takeProfit2.toFixed(2), 'signal');
      } else {
        signalContainer.innerHTML = '<div class="signal-card neutral"><div style="color:#d29922; font-size:12px;">No signal - Confluence ' + score + '/10 (need 5+)</div><div style="font-size:11px; color:#8b949e; margin-top:4px;">Overall bias: ' + analysis.overallBias + '</div></div>';
      }
      
      // Reasoning
      const reasoningList = document.getElementById('reasoning-list');
      reasoningList.innerHTML = analysis.reasoning.map(r => '<li>' + r + '</li>').join('');
      
      log('Analysis complete: ' + analysis.overallBias + ' | Confluence: ' + score + '/10', score >= 5 ? 'signal' : 'warn');
    });
    
    socket.on('memory', (data) => {
      const lessonsList = document.getElementById('lessons-list');
      lessonsList.innerHTML = data.lessons.map(l => '<li>• ' + l + '</li>').join('');
      log('Memory loaded: ' + data.totalTrades + ' trades recorded', 'info');
    });
    
    socket.on('error', (data) => {
      log('ERROR: ' + data.message, 'error');
    });
    
    // Keyboard shortcut
    document.getElementById('symbol-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startAnalysis();
    });
  </script>
</body>
</html>`;
}

export { app, httpServer };
