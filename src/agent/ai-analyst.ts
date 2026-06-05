/**
 * AI Multi-Model Trading Analyst v3
 * 
 * 4 Working Models (tested & confirmed):
 * - gemini-3.5-flash (Google - cepat, analitik)
 * - gemini-3.1-pro (Google - lebih detail)
 * - grok-4.20-fast (xAI - cepat, bagus untuk pattern)
 * - stepfun-ai/step-3.5-flash (StepFun - reasoning kuat)
 * 
 * Backup: multi-model, fallback, blackbox
 * 
 * Semua analisa ditampilkan dalam BAHASA INDONESIA
 */

import axios from 'axios';
import { config } from 'dotenv';
import { MultiTimeframeResult, TradeSignal } from '../analysis/multi-timeframe.js';
import { Candle } from '../analysis/indicators.js';

config();

const API_BASE = process.env.AI_API_BASE_URL || 'https://api.bluesminds.com/v1';
const API_KEY = process.env.AI_API_KEY || '';

// Primary models (tested working & return proper JSON in content field)
const PRIMARY_MODELS = ['gemini-3.5-flash', 'grok-4.20-fast', 'fallback', 'blackbox'];
// Backup if primary fails (slower but work)
const BACKUP_MODELS = ['gemini-3.1-pro', 'multi-model'];

export interface AIModelResult {
  model: string;
  action: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  reasoning: string;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  setup: string;
  success: boolean;
  error?: string;
}

export interface BookAnalysis {
  tradingInTheZone: { canTrade: boolean; reason: string; mindset: string };
  priceActionScalping: { setup: string; pattern: string; signal: string; detail: string };
  artScienceTA: { trend: string; structure: string; srLevels: string; phase: string; emaStatus: string };
  forexFactory: { newsRisk: string; session: string; advice: string };
  multiTimeframe: { daily: string; h4: string; h1: string; m15: string; m5: string };
  overallBookDecision: string; // Keputusan final dari buku dalam bahasa Indonesia
}

export interface AIDecision {
  action: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  reasoning: string;
  technicalFactors: string[];
  riskWarnings: string[];
  marketContext: string;
  setup: string;
  grade: 'A' | 'B' | 'C';
  timeframe: string;
  invalidation: string;
  modelResults: AIModelResult[];
  bookAnalysis: BookAnalysis;
  voteSummary: string;
  indonesianSummary: string; // Ringkasan bahasa Indonesia
}

// Prompt dengan instruksi bahasa Indonesia
function buildPrompt(symbol: string, mtfResult: MultiTimeframeResult, candles: Candle[], price: number): { system: string; user: string } {
  const analyses = mtfResult.analyses;
  const tfLines: string[] = [];
  for (const [tf, a] of Object.entries(analyses)) {
    const sr = a.srLevels.slice(0, 2).map(s => `${s.type[0]}${s.level.toFixed(0)}`).join(',');
    tfLines.push(`${tf}:${a.trend.direction}(${a.trend.strength}) bias=${a.bias} RSI=${a.rsi.toFixed(0)} EMA20=${a.ema20.toFixed(0)} EMA50=${a.ema50.toFixed(0)} ATR=${a.atr.toFixed(0)} pat=[${a.patterns.join(',')||'-'}] SR=[${sr||'-'}]`);
  }
  const last3 = candles.slice(-3).map(c => `${c.close>c.open?'+':'-'}${c.close.toFixed(0)}`).join(' ');

  return {
    system: `You are a professional crypto/forex trading analyst. Use multi-timeframe confluence analysis. Only recommend trades with minimum 5/10 confluence and R:R >= 1.5. If uncertain = WAIT. Respond ONLY in valid JSON format.`,
    user: `Analyze ${symbol} @ ${price.toFixed(2)}
Bias: ${mtfResult.overallBias} | Confluence: ${mtfResult.confluenceScore}/10
${tfLines.join('\n')}
Recent closes: ${last3}

Respond JSON only:
{"action":"BUY"|"SELL"|"WAIT","confidence":0-100,"entry":${price.toFixed(0)},"stopLoss":0,"takeProfit1":0,"takeProfit2":0,"takeProfit3":0,"riskRewardRatio":0,"reasoning":"explain in 1-2 sentences","setup":"setup_name"}`
  };
}

// Call single model with timeout
async function callModel(model: string, system: string, user: string): Promise<AIModelResult> {
  const empty: AIModelResult = { model, success: false, action: 'WAIT', confidence: 0, reasoning: '', entry: 0, stopLoss: 0, takeProfit1: 0, takeProfit2: 0, takeProfit3: 0, riskRewardRatio: 0, setup: '' };
  try {
    const resp = await axios.post(`${API_BASE}/chat/completions`, {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2, max_tokens: 600, stream: false
    }, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 35000 // 35s max per model (some models are slower)
    });

    const choice = resp.data.choices?.[0];
    // Some models put response in content, others in reasoning_content
    let raw = (choice?.message?.content || '').trim();
    
    // If content is empty/null, try reasoning_content (stepfun, qwen models do this)
    if (!raw && choice?.message?.reasoning_content) {
      raw = choice.message.reasoning_content.trim();
    }
    if (!raw && choice?.message?.reasoning) {
      raw = choice.message.reasoning.trim();
    }
    
    // Clean markdown wrappers
    if (raw.startsWith('```')) raw = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    
    // Find JSON object in response (handles models that add text before/after JSON)
    const jsonMatch = raw.match(/\{[^{}]*"action"[^{}]*\}/s) || raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...empty, error: 'no_json' };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      model, success: true,
      action: ['BUY','SELL','WAIT'].includes(parsed.action) ? parsed.action : 'WAIT',
      confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
      reasoning: parsed.reasoning || '',
      entry: parsed.entry || 0, stopLoss: parsed.stopLoss || 0,
      takeProfit1: parsed.takeProfit1 || 0, takeProfit2: parsed.takeProfit2 || 0,
      takeProfit3: parsed.takeProfit3 || 0, riskRewardRatio: parsed.riskRewardRatio || 0,
      setup: parsed.setup || 'unknown'
    };
  } catch (err: any) {
    const code = err.response?.status || (err.code === 'ECONNABORTED' ? 'timeout' : 'error');
    return { ...empty, error: String(code) };
  }
}

// Book-based analysis in BAHASA INDONESIA
function generateBookAnalysis(mtfResult: MultiTimeframeResult, price: number): BookAnalysis {
  const h1 = mtfResult.analyses['H1'];
  const h4 = mtfResult.analyses['H4'];
  const daily = mtfResult.analyses['D'];
  const m15 = mtfResult.analyses['M15'];
  const m5 = mtfResult.analyses['M5'];
  const confluence = mtfResult.confluenceScore;

  // === Trading in the Zone ===
  const zoneCanTrade = confluence >= 5;
  const zoneReason = zoneCanTrade
    ? `Confluence ${confluence}/10 memenuhi syarat minimum. Edge ada, eksekusi sesuai rencana.`
    : `Confluence ${confluence}/10 BELUM cukup (min 5). Sabar menunggu setup yang lebih baik.`;
  const zoneMindset = zoneCanTrade
    ? "Pikirkan dalam probabilitas. Terima hasil apapun — ini hanya satu trade dari banyak seri."
    : "Tidak trading JUGA merupakan posisi. Disiplin > keserakahan.";

  // === Price Action Scalping (Volman) ===
  let paSetup = 'Tidak ada setup yang jelas';
  let paPattern = 'Tidak terdeteksi';
  let paSignal = 'TUNGGU';
  let paDetail = '';

  if (h1) {
    const lastCandle = h1.lastCandle;
    if (h1.patterns.includes('inside_bar')) {
      paSetup = 'IRB (Inside Range Break)'; paPattern = 'Inside Bar di S/R';
      paSignal = h1.bias === 'bullish' ? 'BUY jika break atas' : 'SELL jika break bawah';
    } else if (h1.patterns.includes('pin_bar_bullish')) {
      paSetup = 'Pin Bar Rejection'; paPattern = 'Bullish Pin Bar (ekor bawah panjang)';
      paSignal = 'BUY — buyer menolak harga turun lebih jauh';
    } else if (h1.patterns.includes('pin_bar_bearish')) {
      paSetup = 'Pin Bar Rejection'; paPattern = 'Bearish Pin Bar (ekor atas panjang)';
      paSignal = 'SELL — seller menolak harga naik lebih tinggi';
    } else if (h1.patterns.includes('engulfing_bullish')) {
      paSetup = 'First Break (FB)'; paPattern = 'Bullish Engulfing';
      paSignal = 'BUY — candle bullish menelan bearish sebelumnya';
    } else if (h1.patterns.includes('engulfing_bearish')) {
      paSetup = 'First Break (FB)'; paPattern = 'Bearish Engulfing';
      paSignal = 'SELL — candle bearish menelan bullish sebelumnya';
    } else if (h1.trend.phase === 'correction' && daily) {
      paSetup = 'Pullback in Trend';
      paPattern = 'Koreksi ke EMA di trend utama';
      paSignal = daily.bias === 'bullish' ? 'BUY saat bounce dari EMA/support' : 'SELL saat rejection dari EMA/resistance';
    }

    const bodyType = lastCandle.isDoji ? 'Doji (ragu-ragu)' : lastCandle.body > lastCandle.upperWick ? 'Body besar (keyakinan kuat)' : 'Wick panjang (ada rejection)';
    paDetail = `Candle terakhir: ${lastCandle.isBullish ? '🟢 Bullish' : '🔴 Bearish'} | ${bodyType}. ${lastCandle.isDoji ? 'Pasar belum tentukan arah.' : ''}`;
  }

  // === Art & Science of Technical Analysis (Grimes) ===
  const taTrend = daily ? `${daily.trend.direction === 'up' ? '📈 Naik' : daily.trend.direction === 'down' ? '📉 Turun' : '➡️ Sideways'} (${daily.trend.strength === 'strong' ? 'kuat' : daily.trend.strength === 'moderate' ? 'sedang' : 'lemah'})` : 'Tidak ada data';
  const taStructure = h1 ? (h1.structure.trend === 'bullish' ? 'HH+HL (Bullish)' : h1.structure.trend === 'bearish' ? 'LL+LH (Bearish)' : 'Ranging') : 'N/A';
  const taSR = h4 ? h4.srLevels.slice(0, 3).map(s => `${s.type === 'support' ? 'S' : 'R'}:${s.level.toFixed(0)}(${s.strength}x)`).join(', ') : 'Tidak ada';
  const taPhase = h1 ? (h1.trend.phase === 'impulse' ? '🚀 Impulse (momentum kuat)' : h1.trend.phase === 'correction' ? '🔄 Koreksi (pullback)' : h1.trend.phase === 'accumulation' ? '📦 Akumulasi' : '📤 Distribusi') : 'N/A';
  const emaStatus = h1 ? `${h1.ema20 > h1.ema50 ? 'EMA20>50 (bullish)' : 'EMA20<50 (bearish)'}, Harga ${price > h1.ema20 ? 'DI ATAS' : 'DI BAWAH'} EMA20` : 'N/A';

  // === Forex Factory / Session ===
  const hour = new Date().getUTCHours();
  let session = '🌙 Off-hours (volatilitas rendah)';
  if (hour >= 8 && hour < 16) session = '🇬🇧 London (volatilitas tinggi)';
  else if (hour >= 13 && hour < 21) session = '🇺🇸 New York (volatilitas tinggi)';
  else if (hour >= 0 && hour < 8) session = '🇯🇵 Asia (volatilitas rendah-sedang)';
  const overlap = (hour >= 13 && hour < 16) ? ' ⚡ OVERLAP London+NY (likuiditas terbaik)' : '';
  const newsAdvice = 'Cek ForexFactory sebelum entry — hindari news high-impact 30 menit sebelum/sesudah.';

  // === Multi-timeframe ===
  const mtfDaily = daily ? `${daily.trend.direction === 'up' ? '📈' : daily.trend.direction === 'down' ? '📉' : '➡️'} ${daily.bias} (RSI:${daily.rsi.toFixed(0)})` : 'N/A';
  const mtfH4 = h4 ? `${h4.bias} | ${h4.srLevels.length} level S/R | RSI:${h4.rsi.toFixed(0)}` : 'N/A';
  const mtfH1 = h1 ? `${h1.bias} | Pattern: ${h1.patterns.join(',')||'tidak ada'} | RSI:${h1.rsi.toFixed(0)}` : 'N/A';
  const mtfM15 = m15 ? `${m15.bias} | RSI:${m15.rsi.toFixed(0)}` : 'N/A';
  const mtfM5 = m5 ? `${m5.bias} | RSI:${m5.rsi.toFixed(0)}` : 'N/A';

  // === KEPUTUSAN BUKU (Bahasa Indonesia) ===
  let bookDecision = '';
  if (!zoneCanTrade) {
    bookDecision = `⏸️ TUNGGU — Confluence hanya ${confluence}/10 (butuh min 5). Semua buku sepakat: JANGAN TRADING tanpa edge yang jelas. Sabar!`;
  } else {
    const trendAlign = daily && h1 && daily.bias === h1.bias;
    if (trendAlign && h1.patterns.length > 0) {
      bookDecision = `✅ LAYAK TRADE — Tren Daily ${daily!.bias} SEJALAN dengan H1. Pattern '${h1.patterns[0]}' terdeteksi. Confluence ${confluence}/10. Setup: ${paSetup}. Arah: ${paSignal}.`;
    } else if (trendAlign) {
      bookDecision = `⚠️ SIAP-SIAP — Tren sejalan (D+H1 = ${daily!.bias}) tapi belum ada pattern konfirmasi. Tunggu candle pattern di H1 atau M15.`;
    } else {
      bookDecision = `⚠️ HATI-HATI — Tren Daily (${daily?.bias||'?'}) dan H1 (${h1?.bias||'?'}) TIDAK sejalan. Counter-trend trading berisiko tinggi.`;
    }
  }

  return {
    tradingInTheZone: { canTrade: zoneCanTrade, reason: zoneReason, mindset: zoneMindset },
    priceActionScalping: { setup: paSetup, pattern: paPattern, signal: paSignal, detail: paDetail },
    artScienceTA: { trend: taTrend, structure: taStructure, srLevels: taSR, phase: taPhase, emaStatus },
    forexFactory: { newsRisk: newsAdvice, session: session + overlap, advice: newsAdvice },
    multiTimeframe: { daily: mtfDaily, h4: mtfH4, h1: mtfH1, m15: mtfM15, m5: mtfM5 },
    overallBookDecision: bookDecision
  };
}

// Main function: 4 models parallel + book analysis
export async function analyzeWithAI(
  symbol: string,
  mtfResult: MultiTimeframeResult,
  recentCandles: Candle[],
  currentPrice: number
): Promise<AIDecision> {
  console.log(`🤖 Requesting AI analysis for ${symbol}...`);

  const { system, user } = buildPrompt(symbol, mtfResult, recentCandles, currentPrice);
  const bookAnalysis = generateBookAnalysis(mtfResult, currentPrice);

  // Run 4 primary models in parallel (20s timeout each)
  const results = await Promise.all(PRIMARY_MODELS.map(m => callModel(m, system, user)));

  // Check how many succeeded
  const successCount = results.filter(r => r.success).length;
  
  // If less than 2 succeeded, try backup models
  if (successCount < 2) {
    console.log(`  ⚠️ Only ${successCount} primary succeeded, trying backups...`);
    const backupResults = await Promise.all(BACKUP_MODELS.slice(0, 2).map(m => callModel(m, system, user)));
    results.push(...backupResults);
  }

  results.forEach(r => {
    if (r.success) console.log(`  ✅ ${r.model}: ${r.action} (${r.confidence}%)`);
    else console.log(`  ❌ ${r.model}: failed (${r.error})`);
  });

  // Majority vote
  const successful = results.filter(r => r.success);
  const buyVotes = successful.filter(r => r.action === 'BUY');
  const sellVotes = successful.filter(r => r.action === 'SELL');
  const waitVotes = successful.filter(r => r.action === 'WAIT');

  let finalAction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let winners: AIModelResult[] = [];

  if (buyVotes.length >= 2 && buyVotes.length > sellVotes.length) {
    finalAction = 'BUY'; winners = buyVotes;
  } else if (sellVotes.length >= 2 && sellVotes.length > buyVotes.length) {
    finalAction = 'SELL'; winners = sellVotes;
  } else if (buyVotes.length === 1 && sellVotes.length === 0 && waitVotes.length <= 1 && buyVotes[0].confidence >= 70) {
    finalAction = 'BUY'; winners = buyVotes; // Strong single vote
  } else if (sellVotes.length === 1 && buyVotes.length === 0 && waitVotes.length <= 1 && sellVotes[0].confidence >= 70) {
    finalAction = 'SELL'; winners = sellVotes;
  }

  // Book veto: if books say no trade, override
  if (finalAction !== 'WAIT' && !bookAnalysis.tradingInTheZone.canTrade) {
    finalAction = 'WAIT';
    winners = [];
  }

  const voteSummary = `BUY:${buyVotes.length} SELL:${sellVotes.length} WAIT:${waitVotes.length+results.filter(r=>!r.success).length} → ${finalAction}`;
  console.log(`  📊 Vote: ${voteSummary}`);

  // Build final levels
  const h1 = mtfResult.analyses['H1'];
  const atr = h1?.atr || currentPrice * 0.015;
  let entry = currentPrice, sl = 0, tp1 = 0, tp2 = 0, tp3 = 0, rr = 0;

  if (winners.length > 0) {
    // Average the winners' levels
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const validEntries = winners.filter(w => w.entry > 0);
    if (validEntries.length > 0) {
      entry = avg(validEntries.map(w => w.entry));
      sl = avg(validEntries.filter(w => w.stopLoss > 0).map(w => w.stopLoss)) || (finalAction === 'BUY' ? entry - atr * 1.5 : entry + atr * 1.5);
      tp1 = avg(validEntries.filter(w => w.takeProfit1 > 0).map(w => w.takeProfit1)) || (finalAction === 'BUY' ? entry + atr * 1.5 : entry - atr * 1.5);
      tp2 = avg(validEntries.filter(w => w.takeProfit2 > 0).map(w => w.takeProfit2)) || (finalAction === 'BUY' ? entry + atr * 2.5 : entry - atr * 2.5);
      tp3 = avg(validEntries.filter(w => w.takeProfit3 > 0).map(w => w.takeProfit3)) || (finalAction === 'BUY' ? entry + atr * 4 : entry - atr * 4);
    }
  }
  
  if (finalAction !== 'WAIT' && sl === 0) {
    if (finalAction === 'BUY') { sl = entry - atr*1.5; tp1 = entry+atr*1.5; tp2 = entry+atr*2.5; tp3 = entry+atr*4; }
    else { sl = entry + atr*1.5; tp1 = entry-atr*1.5; tp2 = entry-atr*2.5; tp3 = entry-atr*4; }
  }
  rr = sl !== 0 ? Math.abs(tp2 - entry) / Math.abs(sl - entry) : 0;

  const avgConfidence = winners.length > 0
    ? Math.round(winners.reduce((s, r) => s + r.confidence, 0) / winners.length) : 0;
  const grade = avgConfidence >= 75 ? 'A' : avgConfidence >= 55 ? 'B' : 'C';

  // Build reasoning from winners
  const reasoning = winners.length > 0
    ? winners.map(w => `[${w.model}] ${w.reasoning}`).join(' | ')
    : bookAnalysis.overallBookDecision;

  // Indonesian summary
  let indonesianSummary = '';
  if (finalAction === 'WAIT') {
    indonesianSummary = `⏸️ TIDAK ADA SINYAL — ${bookAnalysis.overallBookDecision}`;
  } else {
    indonesianSummary = `${finalAction === 'BUY' ? '🟢 BELI' : '🔴 JUAL'} — ${winners.length} dari ${successful.length} AI setuju. ` +
      `Entry: ${entry.toFixed(2)}, SL: ${sl.toFixed(2)}, TP: ${tp2.toFixed(2)}. ` +
      `R:R = 1:${rr.toFixed(1)}. ${bookAnalysis.priceActionScalping.setup}. ` +
      `Tren harian: ${bookAnalysis.artScienceTA.trend}. ${bookAnalysis.forexFactory.session}.`;
  }

  return {
    action: finalAction, confidence: avgConfidence,
    entry, stopLoss: sl, takeProfit1: tp1, takeProfit2: tp2, takeProfit3: tp3,
    riskRewardRatio: rr, reasoning,
    technicalFactors: [
      `MTF Bias: ${mtfResult.overallBias}`,
      `Buku PA: ${bookAnalysis.priceActionScalping.setup}`,
      `Struktur: ${bookAnalysis.artScienceTA.structure}`,
      `EMA: ${bookAnalysis.artScienceTA.emaStatus}`,
    ],
    riskWarnings: finalAction === 'WAIT'
      ? ['Tidak ada konsensus AI atau confluence kurang']
      : [`${bookAnalysis.forexFactory.session}`, bookAnalysis.forexFactory.advice],
    marketContext: `${bookAnalysis.artScienceTA.trend} | ${bookAnalysis.artScienceTA.phase}`,
    setup: winners[0]?.setup || bookAnalysis.priceActionScalping.setup,
    grade, timeframe: 'H1',
    invalidation: sl > 0 ? `Harga ${finalAction==='BUY'?'turun di bawah':'naik di atas'} ${sl.toFixed(2)}` : '-',
    modelResults: results, bookAnalysis, voteSummary, indonesianSummary
  };
}

// Convert to signal for paper trading
export function aiDecisionToSignal(decision: AIDecision): TradeSignal | null {
  if (decision.action === 'WAIT') return null;
  if (decision.confidence < 50) return null;
  if (decision.riskRewardRatio < 1.3) return null;
  if (decision.stopLoss === 0) return null;

  return {
    direction: decision.action === 'BUY' ? 'long' : 'short',
    entry: decision.entry, stopLoss: decision.stopLoss,
    takeProfit1: decision.takeProfit1, takeProfit2: decision.takeProfit2, takeProfit3: decision.takeProfit3,
    riskRewardRatio: decision.riskRewardRatio,
    grade: decision.grade, setup: decision.setup,
    confluenceFactors: decision.technicalFactors,
    invalidation: decision.invalidation
  };
}
