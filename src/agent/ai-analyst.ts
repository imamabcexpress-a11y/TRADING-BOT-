/**
 * AI Multi-Model Trading Analyst v2
 * 
 * Runs 4 AI models in PARALLEL for diverse analysis opinions:
 * - Gemini 3.5 Flash (Google - fast, analytical)
 * - Qwen 3.6 Plus (Alibaba - reasoning focused)
 * - MiniMax M2 (strong at structured data)
 * - Blackbox (general purpose)
 * 
 * Each model provides independent BUY/SELL/WAIT decision.
 * Final decision = majority vote + confidence weighting.
 * 
 * Also generates book-based analysis from:
 * - Trading in the Zone (psychology/probability)
 * - Forex Price Action Scalping (candle patterns/setups)
 * - Art & Science of Technical Analysis (structure/S&R/indicators)
 * - Forex Factory Calendar (news awareness)
 */

import axios from 'axios';
import { config } from 'dotenv';
import { MultiTimeframeResult, TradeSignal } from '../analysis/multi-timeframe.js';
import { Candle } from '../analysis/indicators.js';

config();

const API_BASE = process.env.AI_API_BASE_URL || 'https://api.bluesminds.com/v1';
const API_KEY = process.env.AI_API_KEY || '';

// 4 working models for parallel analysis
const AI_MODELS = ['gemini-3.5-flash', 'qwen3.6-plus', 'MiniMax-M2', 'blackbox'];

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
  // Multi-model results
  modelResults: AIModelResult[];
  bookAnalysis: BookAnalysis;
  voteSummary: string;
}

// Compact prompt for each AI model
function buildPrompt(symbol: string, mtfResult: MultiTimeframeResult, candles: Candle[], price: number): { system: string; user: string } {
  const analyses = mtfResult.analyses;
  const tfLines: string[] = [];
  for (const [tf, a] of Object.entries(analyses)) {
    const sr = a.srLevels.slice(0, 2).map(s => `${s.type[0]}${s.level.toFixed(0)}`).join(',');
    tfLines.push(`${tf}:${a.trend.direction}(${a.trend.strength}) bias=${a.bias} RSI=${a.rsi.toFixed(0)} EMA20=${a.ema20.toFixed(0)} ATR=${a.atr.toFixed(0)} pat=[${a.patterns.join(',')||'none'}] SR=[${sr}]`);
  }
  const last3 = candles.slice(-3).map(c => `${c.close>c.open?'+':'-'}${c.close.toFixed(0)}`).join(' ');

  return {
    system: `Trading analyst. Multi-timeframe confluence. Only trade 5+/10 confluence, min RR 1.5. If unsure=WAIT. JSON only, no markdown.`,
    user: `${symbol} @ ${price.toFixed(2)} | Bias:${mtfResult.overallBias} | Conf:${mtfResult.confluenceScore}/10
${tfLines.join('\n')}
Last3: ${last3}
JSON: {"action":"BUY/SELL/WAIT","confidence":0-100,"entry":N,"stopLoss":N,"takeProfit1":N,"takeProfit2":N,"takeProfit3":N,"riskRewardRatio":N,"reasoning":"why","setup":"name"}`
  };
}

// Call single model
async function callModel(model: string, system: string, user: string): Promise<AIModelResult> {
  try {
    const resp = await axios.post(`${API_BASE}/chat/completions`, {
      model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2, max_tokens: 800, stream: false
    }, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const raw = resp.data.choices?.[0]?.message?.content || '';
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(cleaned);
    return {
      model, success: true,
      action: parsed.action || 'WAIT',
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || '',
      entry: parsed.entry || 0,
      stopLoss: parsed.stopLoss || 0,
      takeProfit1: parsed.takeProfit1 || 0,
      takeProfit2: parsed.takeProfit2 || 0,
      takeProfit3: parsed.takeProfit3 || 0,
      riskRewardRatio: parsed.riskRewardRatio || 0,
      setup: parsed.setup || 'unknown'
    };
  } catch (err: any) {
    return {
      model, success: false, error: `${err.response?.status || 'timeout'}`,
      action: 'WAIT', confidence: 0, reasoning: '', entry: 0, stopLoss: 0,
      takeProfit1: 0, takeProfit2: 0, takeProfit3: 0, riskRewardRatio: 0, setup: ''
    };
  }
}

// Generate book-based analysis (local, no API needed)
function generateBookAnalysis(mtfResult: MultiTimeframeResult, price: number): BookAnalysis {
  const h1 = mtfResult.analyses['H1'];
  const h4 = mtfResult.analyses['H4'];
  const daily = mtfResult.analyses['D'];
  const m15 = mtfResult.analyses['M15'];
  const m5 = mtfResult.analyses['M5'];
  const confluence = mtfResult.confluenceScore;

  // Trading in the Zone
  const zoneCanTrade = confluence >= 5;
  const zoneMindset = zoneCanTrade
    ? "Probability favors this trade. Accept the outcome regardless - it's one trade in a series."
    : "Edge not present. Patience IS a position. Wait for the market to come to you.";

  // Price Action Scalping (Volman)
  let paSetup = 'No clear setup';
  let paPattern = 'None detected';
  let paSignal = 'FLAT';
  if (h1) {
    if (h1.patterns.includes('inside_bar')) { paSetup = 'IRB (Inside Range Break)'; paPattern = 'Inside Bar at S/R'; paSignal = h1.bias === 'bullish' ? 'BUY on break above' : 'SELL on break below'; }
    else if (h1.patterns.includes('pin_bar_bullish')) { paSetup = 'Pin Bar Rejection'; paPattern = 'Bullish Pin Bar'; paSignal = 'BUY'; }
    else if (h1.patterns.includes('pin_bar_bearish')) { paSetup = 'Pin Bar Rejection'; paPattern = 'Bearish Pin Bar'; paSignal = 'SELL'; }
    else if (h1.patterns.includes('engulfing_bullish')) { paSetup = 'FB (First Break)'; paPattern = 'Bullish Engulfing'; paSignal = 'BUY'; }
    else if (h1.patterns.includes('engulfing_bearish')) { paSetup = 'FB (First Break)'; paPattern = 'Bearish Engulfing'; paSignal = 'SELL'; }
    else if (h1.trend.phase === 'correction') { paSetup = 'Pullback in Trend'; paPattern = 'Correction reaching EMA'; paSignal = daily?.bias === 'bullish' ? 'BUY on EMA bounce' : 'SELL on EMA rejection'; }
  }
  const paDetail = `Body/wick analysis: ${h1?.lastCandle.isBullish ? 'Last candle bullish' : 'Last candle bearish'}. ` +
    `${h1?.lastCandle.isDoji ? 'Doji = indecision.' : h1?.lastCandle.body && h1.lastCandle.upperWick > h1.lastCandle.body ? 'Upper wick rejection.' : 'Clear directional move.'}`;

  // Art & Science of Technical Analysis (Grimes)
  const taTrend = daily ? `${daily.trend.direction} (${daily.trend.strength})` : 'Unknown';
  const taStructure = h1 ? h1.structure.trend : 'Unknown';
  const taSR = h4 ? h4.srLevels.slice(0, 3).map(s => `${s.type} @ ${s.level.toFixed(0)} (strength:${s.strength})`).join(', ') : 'None';
  const taPhase = h1 ? h1.trend.phase : 'Unknown';
  const emaStatus = h1 ? (h1.ema20 > h1.ema50 ? 'EMA20 > EMA50 (bullish alignment)' : 'EMA20 < EMA50 (bearish alignment)') + `, Price ${price > h1.ema20 ? 'above' : 'below'} EMA20` : 'N/A';

  // Forex Factory / Session
  const hour = new Date().getUTCHours();
  let session = 'Off-hours';
  if (hour >= 8 && hour < 16) session = 'London session (high volatility)';
  else if (hour >= 13 && hour < 21) session = 'New York session (high volatility)';
  else if (hour >= 0 && hour < 8) session = 'Asian session (lower volatility)';
  const newsRisk = 'Check Forex Factory for upcoming high-impact events';
  const newsAdvice = hour >= 13 && hour < 17 ? 'London/NY overlap - best liquidity for execution' : 'Monitor for news releases before entry';

  // Multi-timeframe
  const mtfDaily = daily ? `${daily.trend.direction} trend (${daily.trend.strength}), bias: ${daily.bias}` : 'No data';
  const mtfH4 = h4 ? `Bias: ${h4.bias}, ${h4.srLevels.length} S/R levels, RSI: ${h4.rsi.toFixed(0)}` : 'No data';
  const mtfH1 = h1 ? `Bias: ${h1.bias}, patterns: [${h1.patterns.join(',')||'none'}], RSI: ${h1.rsi.toFixed(0)}` : 'No data';
  const mtfM15 = m15 ? `Bias: ${m15.bias}, RSI: ${m15.rsi.toFixed(0)}, ${m15.patterns.length > 0 ? m15.patterns[0] : 'no pattern'}` : 'No data';
  const mtfM5 = m5 ? `Bias: ${m5.bias}, RSI: ${m5.rsi.toFixed(0)}` : 'No data';

  return {
    tradingInTheZone: { canTrade: zoneCanTrade, reason: zoneCanTrade ? `Confluence ${confluence}/10 meets threshold` : `Confluence ${confluence}/10 below minimum 5`, mindset: zoneMindset },
    priceActionScalping: { setup: paSetup, pattern: paPattern, signal: paSignal, detail: paDetail },
    artScienceTA: { trend: taTrend, structure: taStructure, srLevels: taSR, phase: taPhase, emaStatus },
    forexFactory: { newsRisk, session, advice: newsAdvice },
    multiTimeframe: { daily: mtfDaily, h4: mtfH4, h1: mtfH1, m15: mtfM15, m5: mtfM5 }
  };
}

// Main: Run all 4 models in parallel + book analysis
export async function analyzeWithAI(
  symbol: string,
  mtfResult: MultiTimeframeResult,
  recentCandles: Candle[],
  currentPrice: number
): Promise<AIDecision> {
  console.log(`🤖 Requesting AI analysis for ${symbol}...`);

  const { system, user } = buildPrompt(symbol, mtfResult, recentCandles, currentPrice);
  const bookAnalysis = generateBookAnalysis(mtfResult, currentPrice);

  // Run all 4 models in parallel
  const modelPromises = AI_MODELS.map(m => callModel(m, system, user));
  const results = await Promise.all(modelPromises);

  results.forEach(r => {
    if (r.success) console.log(`  ✅ ${r.model}: ${r.action} (${r.confidence}%)`);
    else console.log(`  ❌ ${r.model}: failed (${r.error})`);
  });

  // Majority vote from successful models
  const successful = results.filter(r => r.success && r.action !== 'WAIT');
  const buyVotes = successful.filter(r => r.action === 'BUY');
  const sellVotes = successful.filter(r => r.action === 'SELL');
  const waitCount = results.filter(r => !r.success || r.action === 'WAIT').length;

  let finalAction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let winners: AIModelResult[] = [];

  if (buyVotes.length >= 2 && buyVotes.length > sellVotes.length) {
    finalAction = 'BUY';
    winners = buyVotes;
  } else if (sellVotes.length >= 2 && sellVotes.length > buyVotes.length) {
    finalAction = 'SELL';
    winners = sellVotes;
  }

  // Check book analysis alignment
  if (finalAction !== 'WAIT' && !bookAnalysis.tradingInTheZone.canTrade) {
    finalAction = 'WAIT'; // Book says no trade
  }

  const voteSummary = `BUY:${buyVotes.length} SELL:${sellVotes.length} WAIT:${waitCount} → ${finalAction}`;
  console.log(`  📊 Vote: ${voteSummary}`);

  // Build final decision
  const avgConfidence = winners.length > 0
    ? Math.round(winners.reduce((s, r) => s + r.confidence, 0) / winners.length)
    : 0;

  const h1 = mtfResult.analyses['H1'];
  const atr = h1?.atr || currentPrice * 0.015;

  let entry = currentPrice, sl = 0, tp1 = 0, tp2 = 0, tp3 = 0, rr = 0;
  if (winners.length > 0 && winners[0].entry > 0) {
    // Use first winner's levels
    entry = winners[0].entry; sl = winners[0].stopLoss;
    tp1 = winners[0].takeProfit1; tp2 = winners[0].takeProfit2; tp3 = winners[0].takeProfit3;
    rr = winners[0].riskRewardRatio;
  } else if (finalAction !== 'WAIT') {
    // Generate from ATR
    if (finalAction === 'BUY') { sl = entry - atr*1.5; tp1 = entry+atr*1.5; tp2 = entry+atr*2.5; tp3 = entry+atr*4; }
    else { sl = entry + atr*1.5; tp1 = entry-atr*1.5; tp2 = entry-atr*2.5; tp3 = entry-atr*4; }
    rr = 2.0;
  }

  const reasoning = winners.length > 0
    ? winners.map(w => `[${w.model}] ${w.reasoning}`).join(' | ')
    : bookAnalysis.tradingInTheZone.reason;

  const grade = avgConfidence >= 80 ? 'A' : avgConfidence >= 60 ? 'B' : 'C';

  return {
    action: finalAction,
    confidence: avgConfidence,
    entry, stopLoss: sl, takeProfit1: tp1, takeProfit2: tp2, takeProfit3: tp3,
    riskRewardRatio: rr,
    reasoning,
    technicalFactors: [
      `Multi-TF: ${mtfResult.overallBias}`,
      `Book: ${bookAnalysis.priceActionScalping.setup}`,
      `Structure: ${bookAnalysis.artScienceTA.structure}`,
      `EMA: ${bookAnalysis.artScienceTA.emaStatus}`,
    ],
    riskWarnings: finalAction === 'WAIT' ? ['No consensus or insufficient confluence'] : [`Session: ${bookAnalysis.forexFactory.session}`],
    marketContext: `${bookAnalysis.artScienceTA.trend} | ${bookAnalysis.artScienceTA.phase} phase`,
    setup: winners[0]?.setup || bookAnalysis.priceActionScalping.setup,
    grade,
    timeframe: 'H1',
    invalidation: sl > 0 ? `Price ${finalAction==='BUY'?'below':'above'} ${sl.toFixed(2)}` : 'N/A',
    modelResults: results,
    bookAnalysis,
    voteSummary
  };
}

// Convert to signal for paper trading
export function aiDecisionToSignal(decision: AIDecision): TradeSignal | null {
  if (decision.action === 'WAIT') return null;
  if (decision.confidence < 55) return null;
  if (decision.riskRewardRatio < 1.3) return null;

  return {
    direction: decision.action === 'BUY' ? 'long' : 'short',
    entry: decision.entry,
    stopLoss: decision.stopLoss,
    takeProfit1: decision.takeProfit1,
    takeProfit2: decision.takeProfit2,
    takeProfit3: decision.takeProfit3,
    riskRewardRatio: decision.riskRewardRatio,
    grade: decision.grade,
    setup: decision.setup,
    confluenceFactors: decision.technicalFactors,
    invalidation: decision.invalidation
  };
}
