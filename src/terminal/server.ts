/**
 * Trading Terminal Server v4.0
 * - Clean TradingView-style UI (chart centered & large)
 * - AI-powered analysis with detailed reasoning
 * - Paper trading with $100, realistic Binance slippage
 * - Live candle countdown per tick
 * - Forex Factory news
 * - Multi-symbol watchlist
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from 'dotenv';
import { connectToTradingView, getMultiTimeframeData, subscribeToQuotes, RealtimeQuote } from '../data/tradingview-connector.js';
import { performMultiTimeframeAnalysis } from '../analysis/multi-timeframe.js';
import { loadMemory, getPerformanceSummary } from '../agent/memory.js';
import { PaperTradingEngine } from '../agent/paper-trading.js';
import { analyzeWithAI, aiDecisionToSignal } from '../agent/ai-analyst.js';
import type { AIDecision } from '../agent/ai-analyst.js';
import axios from 'axios';

config();

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE || '100');
const SLIPPAGE = parseFloat(process.env.SLIPPAGE_PERCENT || '0.05');

const paperEngine = new PaperTradingEngine(STARTING_BALANCE);
const activeQuotes: Record<string, RealtimeQuote> = {};
let newsCache: any[] = [];
let newsLastFetch = 0;

async function fetchNews(): Promise<any[]> {
  if (Date.now() - newsLastFetch < 300000 && newsCache.length > 0) return newsCache;
  try {
    const resp = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { timeout: 10000 });
    if (resp.data && Array.isArray(resp.data)) {
      newsCache = resp.data.map((i: any) => ({ title: i.title||'', country: i.country||'', date: i.date||'', time: i.time||'', impact: i.impact||'Low', forecast: i.forecast||'', previous: i.previous||'', actual: i.actual||'' }));
      newsLastFetch = Date.now();
    }
  } catch (e) { console.error('News fetch error'); }
  return newsCache;
}

app.get('/', (req, res) => res.send(getHTML()));
app.get('/api/news', async (req, res) => res.json(await fetchNews()));

io.on('connection', (socket) => {
  console.log('Terminal connected');
  socket.emit('paper-account', paperEngine.getAccount());
  socket.emit('watchlist-update', activeQuotes);

  let tvConn: any = null;
  let unsub: (() => void) | null = null;
  let interval: NodeJS.Timeout | null = null;
  let autoTrade = true;
  let lastAIDecision: AIDecision | null = null;

  socket.on('subscribe-watchlist', async (data) => {
    try {
      if (!tvConn) tvConn = await connectToTradingView();
      unsub = subscribeToQuotes(tvConn, data.symbols, (q) => {
        activeQuotes[q.symbol] = q;
        socket.emit('quote', q);
        // Update paper positions every tick
        const closed = paperEngine.updatePositions(q.price, q.symbol);
        if (closed.length > 0) {
          closed.forEach(t => socket.emit('trade-closed', t));
          socket.emit('paper-account', paperEngine.getAccount());
        }
        socket.emit('open-positions', paperEngine.getOpenPositions());
      });
      socket.emit('status', { message: `Live: ${data.symbols.length} symbols` });
    } catch (e) { socket.emit('error', { message: String(e) }); }
  });

  socket.on('request-analysis', async (data) => {
    const { symbol } = data;
    socket.emit('status', { message: `AI analyzing ${symbol}...` });
    try {
      if (!tvConn) tvConn = await connectToTradingView();
      const mtfData = await getMultiTimeframeData(tvConn, symbol, 200);
      const techAnalysis = performMultiTimeframeAnalysis(mtfData, symbol);
      socket.emit('candles', { symbol, timeframes: Object.fromEntries(Object.entries(mtfData).map(([tf, c]) => [tf, c.slice(-200)])) });
      socket.emit('tech-analysis', techAnalysis);

      // AI Analysis
      const h1Candles = mtfData['H1'] || mtfData['M15'] || [];
      const currentPrice = h1Candles.length > 0 ? h1Candles[h1Candles.length - 1].close : 0;
      
      let aiDecision: AIDecision;
      try {
        aiDecision = await analyzeWithAI(symbol, techAnalysis, h1Candles, currentPrice);
      } catch (err) {
        aiDecision = { action: 'WAIT', confidence: 0, entry: currentPrice, stopLoss: 0, takeProfit1: 0, takeProfit2: 0, takeProfit3: 0, riskRewardRatio: 0, reasoning: `AI unavailable: ${err}`, technicalFactors: [], riskWarnings: ['AI offline'], marketContext: 'Unknown', setup: 'none', grade: 'C', timeframe: 'H1', invalidation: '', modelResults: [], bookAnalysis: { tradingInTheZone: { canTrade: false, reason: 'AI error', mindset: '' }, priceActionScalping: { setup: '', pattern: '', signal: '', detail: '' }, artScienceTA: { trend: '', structure: '', srLevels: '', phase: '', emaStatus: '' }, forexFactory: { newsRisk: '', session: '', advice: '' }, multiTimeframe: { daily: '', h4: '', h1: '', m15: '', m5: '' }, overallBookDecision: 'AI tidak tersedia' }, voteSummary: 'AI unavailable', indonesianSummary: '⚠️ AI tidak tersedia saat ini' };
      }

      lastAIDecision = aiDecision;
      socket.emit('ai-decision', aiDecision);

      // Auto-execute if enabled
      if (autoTrade && aiDecision.action !== 'WAIT' && aiDecision.confidence >= 60) {
        const signal = aiDecisionToSignal(aiDecision);
        if (signal) {
          // Apply slippage
          const slippageMult = 1 + (SLIPPAGE / 100);
          if (signal.direction === 'long') {
            signal.entry = signal.entry * slippageMult;
          } else {
            signal.entry = signal.entry * (2 - slippageMult);
          }
          const trade = paperEngine.executeSignal(signal, symbol);
          if (trade) {
            socket.emit('trade-opened', { ...trade, aiReasoning: aiDecision.reasoning });
            socket.emit('paper-account', paperEngine.getAccount());
          }
        }
      }

      // Auto-refresh
      if (interval) clearInterval(interval);
      interval = setInterval(async () => {
        try {
          if (tvConn && tvConn.isConnected()) {
            const fresh = await getMultiTimeframeData(tvConn, symbol, 200);
            const freshTech = performMultiTimeframeAnalysis(fresh, symbol);
            socket.emit('candles', { symbol, timeframes: Object.fromEntries(Object.entries(fresh).map(([tf, c]) => [tf, c.slice(-200)])) });
            socket.emit('tech-analysis', freshTech);

            const fh1 = fresh['H1'] || fresh['M15'] || [];
            const fPrice = fh1.length > 0 ? fh1[fh1.length - 1].close : 0;
            try {
              const freshAI = await analyzeWithAI(symbol, freshTech, fh1, fPrice);
              lastAIDecision = freshAI;
              socket.emit('ai-decision', freshAI);
              if (autoTrade && freshAI.action !== 'WAIT' && freshAI.confidence >= 60) {
                const sig = aiDecisionToSignal(freshAI);
                if (sig) {
                  const sm = 1 + (SLIPPAGE / 100);
                  if (sig.direction === 'long') sig.entry *= sm; else sig.entry *= (2 - sm);
                  const t = paperEngine.executeSignal(sig, symbol);
                  if (t) { socket.emit('trade-opened', { ...t, aiReasoning: freshAI.reasoning }); socket.emit('paper-account', paperEngine.getAccount()); }
                }
              }
            } catch (e) { /* AI error, skip */ }
          }
        } catch (e) { console.error('Refresh err:', e); }
      }, 120000); // Every 2 min

      socket.emit('status', { message: `AI: ${aiDecision.action} (${aiDecision.confidence}%)` });
    } catch (e) { socket.emit('error', { message: String(e) }); }
  });

  socket.on('request-news', async () => { socket.emit('news-update', await fetchNews()); });
  socket.on('toggle-auto-trade', (v) => { autoTrade = v; });
  socket.on('manual-close', (d) => { const c = paperEngine.manualClose(d.tradeId, d.price); if (c) { socket.emit('trade-closed', c); socket.emit('paper-account', paperEngine.getAccount()); } });
  socket.on('reset-account', () => { paperEngine.reset(STARTING_BALANCE); socket.emit('paper-account', paperEngine.getAccount()); });

  socket.on('disconnect', () => {
    if (interval) clearInterval(interval);
    if (unsub) unsub();
    if (tvConn) tvConn.close().catch(() => {});
    tvConn = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n🤖 Trading Bot v4.0 | http://localhost:${PORT}\n   AI: ${process.env.AI_MODEL || 'gpt-4o'} | Balance: $${STARTING_BALANCE} | Slippage: ${SLIPPAGE}%\n`);
  fetchNews();
});

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trading Bot</title>
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
<style>
:root{--bg:#131722;--bg2:#1e222d;--bg3:#2a2e39;--border:#363a45;--t1:#d1d4dc;--t2:#787b86;--t3:#4c525e;--green:#26a69a;--red:#ef5350;--blue:#2962ff;--yellow:#ff9800;--purple:#7c4dff}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--t1);overflow:hidden;height:100vh}

/* TOOLBAR */
.toolbar{height:42px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;gap:4px}
.tb-grp{display:flex;align-items:center;gap:3px;padding:0 10px;border-right:1px solid var(--bg3);height:100%}
.tb-grp:last-child{border:none}
.btn{background:none;border:none;color:var(--t2);padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;transition:.15s}
.btn:hover{background:var(--bg3);color:var(--t1)}
.btn.on{background:var(--blue);color:#fff}
.btn.sym{font-size:14px;font-weight:700;color:var(--t1)}
.price-big{font-size:22px;font-weight:800;padding:0 10px;letter-spacing:-.5px}
.price-big.up{color:var(--green)}.price-big.down{color:var(--red)}
.chg{font-size:11px;padding:2px 6px;border-radius:3px}
.chg.up{color:var(--green);background:rgba(38,166,154,.12)}.chg.down{color:var(--red);background:rgba(239,83,80,.12)}
.countdown{font-family:monospace;font-size:13px;font-weight:600;color:var(--yellow);padding:0 8px}
.spacer{flex:1}
.sw{position:relative;display:inline-block;width:30px;height:16px;margin:0 4px}
.sw input{opacity:0;width:0;height:0}
.sw .sl{position:absolute;cursor:pointer;inset:0;background:var(--bg3);border-radius:8px;transition:.3s}
.sw .sl:before{content:'';position:absolute;height:12px;width:12px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.3s}
.sw input:checked+.sl{background:var(--green)}
.sw input:checked+.sl:before{transform:translateX(14px)}
.lbl{font-size:10px;color:var(--t2);display:flex;align-items:center;gap:3px}

/* LAYOUT: chart big center, thin panels left/right */
.layout{display:grid;grid-template-columns:180px 1fr 260px;height:calc(100vh - 42px)}

/* LEFT: Watchlist */
.left{background:var(--bg);border-right:1px solid var(--bg3);overflow-y:auto}
.wl-hd{padding:8px 10px;font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bg3);position:sticky;top:0;background:var(--bg);z-index:1}
.wl-it{display:grid;grid-template-columns:1fr auto;padding:7px 10px;cursor:pointer;border-bottom:1px solid rgba(42,46,57,.3);transition:.1s}
.wl-it:hover{background:var(--bg2)}
.wl-it.act{background:var(--bg3);border-left:2px solid var(--blue)}
.wl-s{font-size:11px;font-weight:600}.wl-n{font-size:8px;color:var(--t3);margin-top:1px}
.wl-p{text-align:right;font-size:11px;font-weight:500}.wl-p.up{color:var(--green)}.wl-p.down{color:var(--red)}
.wl-c{text-align:right;font-size:8px}.wl-c.up{color:var(--green)}.wl-c.down{color:var(--red)}

/* CENTER: Chart */
.center{display:flex;flex-direction:column;overflow:hidden}
.chart-wrap{flex:1;position:relative}
#chart{width:100%;height:100%}
.log-bar{height:100px;background:var(--bg2);border-top:1px solid var(--bg3);overflow-y:auto;padding:6px 10px;font-family:monospace;font-size:10px}
.ll{padding:1px 0;display:flex;gap:6px}
.ll .t{color:var(--t3);min-width:55px}.ll .m{color:var(--t2)}
.ll .m.i{color:var(--blue)}.ll .m.s{color:var(--green);font-weight:600}.ll .m.w{color:var(--yellow)}.ll .m.e{color:var(--red)}.ll .m.tr{color:var(--purple);font-weight:600}

/* RIGHT: Account + AI + Positions + News */
.right{background:var(--bg);border-left:1px solid var(--bg3);overflow-y:auto;font-size:11px}
.sec{border-bottom:1px solid var(--bg3);padding:10px}
.sec-t{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:8px}

/* Account */
.acct{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.ac{background:var(--bg2);border-radius:4px;padding:5px 7px}
.ac-l{font-size:8px;color:var(--t3)}.ac-v{font-size:12px;font-weight:700;margin-top:1px}
.ac-v.up{color:var(--green)}.ac-v.down{color:var(--red)}

/* AI Decision Box */
.ai-box{background:var(--bg2);border-radius:6px;padding:10px;border-top:3px solid var(--t3)}
.ai-box.BUY{border-top-color:var(--green)}.ai-box.SELL{border-top-color:var(--red)}
.ai-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.ai-action{font-size:15px;font-weight:800;letter-spacing:1px}
.ai-action.BUY{color:var(--green)}.ai-action.SELL{color:var(--red)}.ai-action.WAIT{color:var(--t3)}
.ai-conf{font-size:10px;padding:2px 6px;border-radius:3px;font-weight:700}
.ai-conf.hi{background:rgba(38,166,154,.15);color:var(--green)}
.ai-conf.md{background:rgba(255,152,0,.15);color:var(--yellow)}
.ai-conf.lo{background:rgba(239,83,80,.15);color:var(--red)}
.ai-reason{font-size:10px;color:var(--t2);line-height:1.6;margin:6px 0;padding:6px;background:var(--bg);border-radius:4px;border-left:2px solid var(--purple)}
.ai-lvls{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:10px;margin-top:6px}
.ai-lbl{color:var(--t3)}.ai-val{font-weight:600;text-align:right}

/* Positions */
.pos{background:var(--bg2);border-radius:5px;padding:7px;margin-bottom:5px;border-left:3px solid var(--t3)}
.pos.long{border-left-color:var(--green)}.pos.short{border-left-color:var(--red)}
.pos-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.pos-d{font-weight:700;font-size:10px}.pos-d.long{color:var(--green)}.pos-d.short{color:var(--red)}
.pos-x{background:var(--bg3);border:none;color:var(--t2);padding:1px 5px;border-radius:2px;cursor:pointer;font-size:8px}
.pos-x:hover{background:var(--red);color:#fff}
.pos-info{color:var(--t3);font-size:9px;line-height:1.5}

/* News */
.nw{padding:4px 0;border-bottom:1px solid rgba(42,46,57,.3)}
.nw:last-child{border:none}
.nw-t{font-size:8px;color:var(--t3)}.nw-title{font-size:9px;margin-top:1px}
.imp{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:3px}
.imp.High{background:var(--red)}.imp.Medium{background:var(--yellow)}.imp.Low{background:var(--t3)}

/* History */
.hi{display:grid;grid-template-columns:auto 1fr auto;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,46,57,.2);align-items:center}
.hi-d{font-weight:700;font-size:9px;padding:1px 3px;border-radius:2px}
.hi-d.long{color:var(--green);background:rgba(38,166,154,.1)}.hi-d.short{color:var(--red);background:rgba(239,83,80,.1)}
.hi-i{font-size:8px;color:var(--t3)}.hi-p{font-weight:700;font-size:10px}
.hi-p.w{color:var(--green)}.hi-p.l{color:var(--red)}

/* Notif */
.notif{position:fixed;top:50px;right:16px;background:var(--bg2);border:1px solid var(--green);border-radius:10px;padding:12px 16px;z-index:9999;animation:sIn .3s;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:260px}
.notif.SELL{border-color:var(--red)}
@keyframes sIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.nf-x{position:absolute;top:6px;right:8px;background:none;border:none;color:var(--t3);cursor:pointer;font-size:12px}
.nf-t{font-size:12px;font-weight:700}.nf-t.BUY{color:var(--green)}.nf-t.SELL{color:var(--red)}
.nf-b{font-size:9px;color:var(--t2);line-height:1.5;margin-top:4px}

::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:2px}
</style>
</head>
<body>
<div class="toolbar">
  <div class="tb-grp"><button class="btn sym" id="sym-btn" onclick="symSearch()">BTC/USDT</button></div>
  <div class="tb-grp" id="tf-bar">
    <button class="btn" data-tf="M5">5m</button>
    <button class="btn" data-tf="M15">15m</button>
    <button class="btn on" data-tf="H1">1H</button>
    <button class="btn" data-tf="H4">4H</button>
    <button class="btn" data-tf="D">1D</button>
  </div>
  <div class="tb-grp">
    <span class="price-big" id="price">--</span>
    <span class="chg" id="chg">--</span>
  </div>
  <div class="tb-grp"><span class="countdown" id="cd">--:--</span></div>
  <div class="spacer"></div>
  <div class="tb-grp">
    <span class="lbl">Auto<label class="sw"><input type="checkbox" id="auto-sw" checked><span class="sl"></span></label></span>
    <span class="lbl">🔊<label class="sw"><input type="checkbox" id="snd-sw" checked><span class="sl"></span></label></span>
  </div>
  <div class="tb-grp"><button class="btn" onclick="analyze()" style="color:var(--green);font-weight:700">▶ AI Analyze</button></div>
  <div class="tb-grp"><button class="btn" onclick="resetAcct()" style="font-size:10px">🔄 Reset</button></div>
</div>

<div class="layout">
  <!-- LEFT: Watchlist -->
  <div class="left">
    <div class="wl-hd">Watchlist</div>
    <div id="wl"></div>
  </div>

  <!-- CENTER: Chart + Log -->
  <div class="center">
    <div class="chart-wrap"><div id="chart"></div></div>
    <div class="log-bar" id="log"></div>
  </div>

  <!-- RIGHT: Everything -->
  <div class="right">
    <div class="sec">
      <div class="sec-t">💰 Paper Account ($${STARTING_BALANCE} start)</div>
      <div class="acct">
        <div class="ac"><div class="ac-l">Balance</div><div class="ac-v" id="a-bal">$${STARTING_BALANCE}</div></div>
        <div class="ac"><div class="ac-l">Equity</div><div class="ac-v" id="a-eq">$${STARTING_BALANCE}</div></div>
        <div class="ac"><div class="ac-l">W / L</div><div class="ac-v" id="a-wl">0 / 0</div></div>
        <div class="ac"><div class="ac-l">Win Rate</div><div class="ac-v" id="a-wr">0%</div></div>
        <div class="ac"><div class="ac-l">P&L</div><div class="ac-v" id="a-pnl">$0</div></div>
        <div class="ac"><div class="ac-l">PF</div><div class="ac-v" id="a-pf">--</div></div>
      </div>
    </div>
    <div class="sec">
      <div class="sec-t">🤖 AI Decision</div>
      <div id="ai-box"><div class="ai-box"><div style="text-align:center;color:var(--t3);padding:12px">Click AI Analyze to start</div></div></div>
    </div>
    <div class="sec">
      <div class="sec-t">💼 Open Positions</div>
      <div id="pos-box"><div style="color:var(--t3);text-align:center;padding:6px">No positions</div></div>
    </div>
    <div class="sec">
      <div class="sec-t">📰 News (Forex Factory)</div>
      <div id="news-box" style="max-height:140px;overflow-y:auto"><div style="color:var(--t3)">Loading...</div></div>
    </div>
    <div class="sec">
      <div class="sec-t">📜 History</div>
      <div id="hist-box" style="max-height:140px;overflow-y:auto"><div style="color:var(--t3)">No trades</div></div>
    </div>
  </div>
</div>

<div id="nf-wrap"></div>

<script>
const socket=io();
let chart,cSeries,vSeries,curSym='BINANCE:BTCUSDT',curTF='H1',cData={},sndOn=true,lastP=0,lastNfId='';
const WL=[
  {s:'BINANCE:BTCUSDT',n:'Bitcoin',sh:'BTC/USDT'},
  {s:'BINANCE:ETHUSDT',n:'Ethereum',sh:'ETH/USDT'},
  {s:'TVC:GOLD',n:'Gold',sh:'XAU/USD'},
  {s:'BINANCE:SOLUSDT',n:'Solana',sh:'SOL/USDT'},
  {s:'BINANCE:BNBUSDT',n:'BNB',sh:'BNB/USDT'},
  {s:'FX:EURUSD',n:'EUR/USD',sh:'EUR/USD'}
];
const TFS={M1:60,M5:300,M15:900,H1:3600,H4:14400,D:86400};

// Audio
const AC=window.AudioContext||window.webkitAudioContext;let actx;
function iA(){if(!actx)actx=new AC()}
function snd(t){if(!sndOn)return;iA();const o=actx.createOscillator(),g=actx.createGain();o.connect(g);g.connect(actx.destination);
if(t==='BUY'){o.frequency.setValueAtTime(523,actx.currentTime);o.frequency.setValueAtTime(659,actx.currentTime+.1);o.frequency.setValueAtTime(784,actx.currentTime+.2)}
else{o.frequency.setValueAtTime(784,actx.currentTime);o.frequency.setValueAtTime(659,actx.currentTime+.1);o.frequency.setValueAtTime(523,actx.currentTime+.2)}
g.gain.setValueAtTime(.2,actx.currentTime);g.gain.exponentialRampToValueAtTime(.01,actx.currentTime+.4);o.start();o.stop(actx.currentTime+.4)}
document.getElementById('snd-sw').onchange=e=>{sndOn=e.target.checked;iA()};
document.getElementById('auto-sw').onchange=e=>socket.emit('toggle-auto-trade',e.target.checked);

// Countdown
setInterval(()=>{const s=TFS[curTF]||3600;const r=s-Math.floor(Date.now()/1000)%s;const m=Math.floor(r/60),sc=r%60;document.getElementById('cd').textContent=(m<10?'0':'')+m+':'+(sc<10?'0':'')+sc},1000);

// Chart
function initC(){const c=document.getElementById('chart');
chart=LightweightCharts.createChart(c,{width:c.clientWidth,height:c.clientHeight,layout:{background:{color:'#131722'},textColor:'#d1d4dc'},grid:{vertLines:{color:'#1e222d'},horzLines:{color:'#1e222d'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},timeScale:{borderColor:'#2a2e39',timeVisible:true},rightPriceScale:{borderColor:'#2a2e39'}});
cSeries=chart.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderUpColor:'#26a69a',borderDownColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350'});
vSeries=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',scaleMargins:{top:.85,bottom:0}});
new ResizeObserver(()=>chart.applyOptions({width:c.clientWidth,height:c.clientHeight})).observe(c)}
initC();
function updChart(d){if(!d||!d.length)return;cSeries.setData(d.map(c=>({time:c.timestamp,open:c.open,high:c.high,low:c.low,close:c.close})));vSeries.setData(d.map(c=>({time:c.timestamp,value:c.volume||0,color:c.close>=c.open?'rgba(38,166,154,.25)':'rgba(239,83,80,.25)'})));chart.timeScale().fitContent()}

// Watchlist
function rWL(){document.getElementById('wl').innerHTML=WL.map(w=>{const a=w.s===curSym?' act':'';const id=w.s.replace(/[:.]/g,'-');
return '<div class="wl-it'+a+'" onclick="sel(\\''+w.s+'\\')"><div><div class="wl-s">'+w.sh+'</div><div class="wl-n">'+w.n+'</div></div><div><div class="wl-p" id="wp-'+id+'">--</div><div class="wl-c" id="wc-'+id+'">--</div></div></div>'}).join('')}
rWL();
function sel(s){curSym=s;const i=WL.find(w=>w.s===s);document.getElementById('sym-btn').textContent=i?i.sh:s;rWL();analyze()}
function switchTF(tf){curTF=tf;document.querySelectorAll('#tf-bar .btn').forEach(b=>b.classList.toggle('on',b.dataset.tf===tf));if(cData[tf])updChart(cData[tf])}
document.querySelectorAll('#tf-bar .btn').forEach(b=>b.onclick=()=>switchTF(b.dataset.tf));
function analyze(){lg('AI analyzing '+curSym+'...','i');socket.emit('request-analysis',{symbol:curSym})}
function resetAcct(){if(confirm('Reset to $${STARTING_BALANCE}?')){socket.emit('reset-account');lg('Account reset','w')}}
function symSearch(){const s=prompt('Symbol:');if(s)sel(s)}

// Socket
socket.on('connect',()=>{lg('Connected','i');socket.emit('subscribe-watchlist',{symbols:WL.map(w=>w.s)});socket.emit('request-news')});
socket.on('quote',q=>{lastP=q.price;
if(q.symbol===curSym||q.symbol.includes(curSym.split(':')[1])){document.getElementById('price').textContent=q.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});document.getElementById('price').className='price-big '+(q.changePercent>=0?'up':'down');const s=q.changePercent>=0?'+':'';document.getElementById('chg').textContent=s+q.changePercent.toFixed(2)+'%';document.getElementById('chg').className='chg '+(q.changePercent>=0?'up':'down')}
const id=q.symbol.replace(/[:.]/g,'-');const pe=document.getElementById('wp-'+id),ce=document.getElementById('wc-'+id);
if(pe){pe.textContent=q.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});pe.className='wl-p '+(q.changePercent>=0?'up':'down')}
if(ce){ce.textContent=(q.changePercent>=0?'+':'')+q.changePercent.toFixed(2)+'%';ce.className='wl-c '+(q.changePercent>=0?'up':'down')}});

socket.on('candles',d=>{cData=d.timeframes;if(cData[curTF])updChart(cData[curTF]);else{const fb=cData['H1']||cData[Object.keys(cData)[0]];if(fb)updChart(fb)}});

socket.on('ai-decision',d=>{
  const box=document.getElementById('ai-box');
  const confCls=d.confidence>=70?'hi':d.confidence>=50?'md':'lo';
  // Indonesian summary (prominent)
  let summaryHtml='<div style="padding:8px;background:var(--bg);border-radius:4px;margin-bottom:8px;font-size:10px;line-height:1.6;border-left:3px solid '+(d.action==='BUY'?'var(--green)':d.action==='SELL'?'var(--red)':'var(--yellow)')+'">'+(d.indonesianSummary||d.reasoning)+'</div>';
  // Levels
  let lvls='';
  if(d.action!=='WAIT'&&d.stopLoss>0){lvls='<div class="ai-lvls"><span class="ai-lbl">Entry</span><span class="ai-val">'+d.entry.toFixed(2)+'</span><span class="ai-lbl">SL</span><span class="ai-val" style="color:var(--red)">'+d.stopLoss.toFixed(2)+'</span><span class="ai-lbl">TP1</span><span class="ai-val" style="color:var(--green)">'+d.takeProfit1.toFixed(2)+'</span><span class="ai-lbl">TP2</span><span class="ai-val" style="color:var(--green)">'+d.takeProfit2.toFixed(2)+'</span><span class="ai-lbl">TP3</span><span class="ai-val" style="color:var(--green)">'+d.takeProfit3.toFixed(2)+'</span><span class="ai-lbl">R:R</span><span class="ai-val" style="color:var(--yellow)">1:'+d.riskRewardRatio.toFixed(1)+'</span></div>'}
  // Model votes
  let modelHtml='';
  if(d.modelResults&&d.modelResults.length){modelHtml='<div style="margin-top:8px;border-top:1px solid var(--bg3);padding-top:6px"><div style="font-size:9px;font-weight:600;color:var(--t3);margin-bottom:4px">🤖 VOTE AI: '+d.voteSummary+'</div>'+d.modelResults.map(r=>{const col=r.action==='BUY'?'var(--green)':r.action==='SELL'?'var(--red)':'var(--t3)';return'<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:9px;border-bottom:1px solid rgba(42,46,57,.2)"><span style="color:var(--t2)">'+r.model.split('/').pop()+'</span><span style="color:'+col+';font-weight:600">'+(r.success?r.action+' '+r.confidence+'%':'❌ '+r.error)+'</span></div>'+(r.success&&r.reasoning?'<div style="font-size:8px;color:var(--t3);padding:1px 0 3px;font-style:italic">'+r.reasoning.substring(0,120)+'</div>':'')}).join('')+'</div>'}
  // Book analysis in Indonesian
  let bookHtml='';
  if(d.bookAnalysis){const b=d.bookAnalysis;bookHtml='<div style="margin-top:8px;border-top:1px solid var(--bg3);padding-top:6px"><div style="font-size:9px;font-weight:600;color:var(--t3);margin-bottom:4px">📚 ANALISA BUKU</div><div style="font-size:9px;line-height:1.7;color:var(--t2)"><div style="margin-bottom:3px"><b style="color:var(--purple)">🧠 Zone (Psikologi):</b> '+(b.tradingInTheZone.canTrade?'✅':'❌')+' '+b.tradingInTheZone.reason+'</div><div style="margin-bottom:3px"><b style="color:var(--yellow)">📊 Price Action:</b> '+b.priceActionScalping.setup+'<br>&nbsp;&nbsp;→ '+b.priceActionScalping.signal+'<br>&nbsp;&nbsp;'+b.priceActionScalping.detail+'</div><div style="margin-bottom:3px"><b style="color:var(--blue)">📐 Teknikal:</b> Tren: '+b.artScienceTA.trend+' | Fase: '+b.artScienceTA.phase+'<br>&nbsp;&nbsp;Struktur: '+b.artScienceTA.structure+' | '+b.artScienceTA.emaStatus+'<br>&nbsp;&nbsp;S/R: '+b.artScienceTA.srLevels+'</div><div style="margin-bottom:3px"><b style="color:var(--green)">🌍 Session:</b> '+b.forexFactory.session+'</div><div style="font-size:8px;color:var(--t3)"><b>MTF:</b> D:'+b.multiTimeframe.daily+' | H4:'+b.multiTimeframe.h4+' | H1:'+b.multiTimeframe.h1+'<br>M15:'+b.multiTimeframe.m15+' | M5:'+b.multiTimeframe.m5+'</div></div>'+(b.overallBookDecision?'<div style="margin-top:6px;padding:6px;background:var(--bg3);border-radius:4px;font-size:10px;font-weight:500">'+b.overallBookDecision+'</div>':'')+'</div>'}
  box.innerHTML='<div class="ai-box '+d.action+'"><div class="ai-hd"><span class="ai-action '+d.action+'">'+d.action+'</span><span class="ai-conf '+confCls+'">'+d.confidence+'%</span></div>'+summaryHtml+lvls+modelHtml+bookHtml+'</div>';
  if(d.action!=='WAIT'&&d.confidence>=50){showNf(d);lg('🎯 '+d.action+' @ '+d.entry.toFixed(2)+' | Vote:'+d.voteSummary,'s')}else{lg('⏸️ WAIT — '+d.voteSummary+(d.bookAnalysis?' | Buku: '+(d.bookAnalysis.overallBookDecision||'').substring(0,60):''),'w')}
});

socket.on('paper-account',a=>{
  document.getElementById('a-bal').textContent='$'+a.balance.toFixed(2);
  document.getElementById('a-eq').textContent='$'+a.equity.toFixed(2);
  document.getElementById('a-wl').textContent=a.wins+'W / '+a.losses+'L';
  document.getElementById('a-wr').textContent=(a.winRate*100).toFixed(0)+'%';document.getElementById('a-wr').className='ac-v '+(a.winRate>=.5?'up':'down');
  document.getElementById('a-pnl').textContent=(a.totalPnL>=0?'+':'')+a.totalPnL.toFixed(2);document.getElementById('a-pnl').className='ac-v '+(a.totalPnL>=0?'up':'down');
  document.getElementById('a-pf').textContent=a.profitFactor===Infinity?'∞':a.profitFactor.toFixed(2);
  // History
  if(a.trades&&a.trades.length>0){document.getElementById('hist-box').innerHTML=a.trades.slice().reverse().slice(0,15).map(t=>{const p=t.pnlR||0;return'<div class="hi"><span class="hi-d '+t.direction+'">'+t.direction[0].toUpperCase()+'</span><span class="hi-i">'+t.status+'</span><span class="hi-p '+(p>0?'w':'l')+'">'+(p>0?'+':'')+p.toFixed(2)+'R</span></div>'}).join('')}
});

socket.on('open-positions',ps=>{const c=document.getElementById('pos-box');
  if(!ps||!ps.length){c.innerHTML='<div style="color:var(--t3);text-align:center;padding:6px">No positions</div>';return}
  c.innerHTML=ps.map(p=>{const rpu=Math.abs(p.entry-p.stopLoss);const pnl=p.direction==='long'?(lastP-p.entry)/rpu:(p.entry-lastP)/rpu;const cls=pnl>=0?'up':'down';
  return'<div class="pos '+p.direction+'"><div class="pos-hd"><span class="pos-d '+p.direction+'">'+p.direction.toUpperCase()+'</span><button class="pos-x" onclick="closeP(\\''+p.id+'\\')">✕</button></div><div class="pos-info">Entry: '+p.entry.toFixed(2)+' | SL: '+p.stopLoss.toFixed(2)+'<br>PnL: <span style="color:var(--'+cls+')">'+(pnl>=0?'+':'')+pnl.toFixed(2)+'R</span>'+(p.trailingStop?' | Trail:'+p.trailingStop.toFixed(2):'')+'</div></div>'}).join('')});

socket.on('trade-opened',t=>{lg('🟢 OPEN '+t.direction.toUpperCase()+' @ '+t.entry.toFixed(2)+(t.aiReasoning?' | '+t.aiReasoning.substring(0,80):''),'tr');snd('BUY')});
socket.on('trade-closed',t=>{const p=t.pnlR||0;lg((p>0?'✅':'❌')+' CLOSE '+(p>0?'+':'')+p.toFixed(2)+'R | '+t.status,'tr');snd(p>0?'BUY':'SELL')});
socket.on('news-update',news=>{const c=document.getElementById('news-box');if(!news||!news.length){c.innerHTML='<div style="color:var(--t3)">No news</div>';return}const today=new Date().toISOString().split('T')[0];c.innerHTML=news.filter(n=>n.impact==='High'||n.date===today).slice(0,12).map(n=>'<div class="nw"><div class="nw-t"><span class="imp '+n.impact+'"></span>'+n.time+' '+n.country+'</div><div class="nw-title">'+n.title+(n.actual?' → '+n.actual:'')+'</div></div>').join('')});
socket.on('status',d=>{lg(d.message,'i')});
socket.on('error',d=>{lg('ERR: '+d.message,'e')});

function closeP(id){socket.emit('manual-close',{tradeId:id,price:lastP})}
function showNf(d){const id=d.action+d.entry.toFixed(0);if(id===lastNfId)return;lastNfId=id;const div=document.createElement('div');div.className='notif '+d.action;div.innerHTML='<button class="nf-x" onclick="this.parentElement.remove()">✕</button><div class="nf-t '+d.action+'">🤖 '+d.action+' ['+d.grade+']</div><div class="nf-b">'+d.reasoning.substring(0,120)+'<br>Entry: '+d.entry.toFixed(2)+' | RR 1:'+d.riskRewardRatio.toFixed(1)+'</div>';document.getElementById('nf-wrap').appendChild(div);setTimeout(()=>div.remove(),8000)}
function lg(m,t='i'){const p=document.getElementById('log');const tm=new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});p.innerHTML+='<div class="ll"><span class="t">'+tm+'</span><span class="m '+t+'">'+m+'</span></div>';p.scrollTop=p.scrollHeight}

setTimeout(()=>analyze(),1500);
setInterval(()=>socket.emit('request-news'),300000);
</script>
</body></html>`;
}

export { app, httpServer };
