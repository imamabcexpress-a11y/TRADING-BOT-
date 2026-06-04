/**
 * Multi-Timeframe Analysis Engine
 * 
 * Daily = Trend Direction (the "wind at your back")
 * H4 = Key Support & Resistance levels
 * H1 = Entry Setup identification
 * M15 = Confirmation signal
 * M5-M1 = Scalping execution precision
 */

import { Candle, calculateEMA, calculateRSI, calculateATR, calculateMACD } from './indicators.js';
import { 
  identifyMarketStructure, 
  PriceActionCandle,
  detectPinBar,
  detectEngulfing,
  detectInsideBar
} from '../knowledge/price-action-scalping.js';
import { 
  findSupportResistanceLevels, 
  analyzeTrend, 
  SupportResistance, 
  TrendAnalysis 
} from '../knowledge/art-science-technical-analysis.js';

export type TimeframeRole = 'trend_direction' | 'key_support_resistance' | 'entry_setup' | 'confirmation' | 'scalp_execution';

export interface TimeframeAnalysis {
  timeframe: string;
  role: TimeframeRole;
  trend: TrendAnalysis;
  structure: ReturnType<typeof identifyMarketStructure>;
  srLevels: SupportResistance[];
  rsi: number;
  atr: number;
  ema20: number;
  ema50: number;
  ema200: number;
  lastCandle: PriceActionCandle;
  patterns: string[];
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
}

export interface MultiTimeframeResult {
  symbol: string;
  timestamp: number;
  analyses: Record<string, TimeframeAnalysis>;
  overallBias: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  confluenceScore: number;
  signal: TradeSignal | null;
  reasoning: string[];
}

export interface TradeSignal {
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  grade: 'A' | 'B' | 'C';
  setup: string;
  confluenceFactors: string[];
  invalidation: string;
}

function candleToPriceAction(candle: Candle): PriceActionCandle {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const totalRange = candle.high - candle.low;
  
  return {
    ...candle,
    body,
    upperWick,
    lowerWick,
    isBullish: candle.close > candle.open,
    isBearish: candle.close < candle.open,
    isDoji: totalRange > 0 ? body / totalRange < 0.1 : true
  };
}

function analyzeTimeframe(
  candles: Candle[],
  timeframe: string,
  role: TimeframeRole
): TimeframeAnalysis {
  const closes = candles.map(c => c.close);
  const priceActionCandles = candles.map(candleToPriceAction);
  
  // Calculate indicators
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(candles, 14);
  
  const lastIdx = candles.length - 1;
  const lastCandle = priceActionCandles[lastIdx];
  
  // Trend analysis
  const trend = analyzeTrend(
    candles.map(c => ({ close: c.close, high: c.high, low: c.low })),
    ema20,
    ema50,
    ema200
  );
  
  // Market structure
  const structure = identifyMarketStructure(priceActionCandles);
  
  // S/R levels
  const srLevels = findSupportResistanceLevels(candles, timeframe);
  
  // Pattern detection on recent candles
  const patterns: string[] = [];
  if (lastIdx > 0) {
    const prev = priceActionCandles[lastIdx - 1];
    const pinBar = detectPinBar(lastCandle);
    if (pinBar.isPin) patterns.push(`pin_bar_${pinBar.direction}`);
    
    const engulfing = detectEngulfing(prev, lastCandle);
    if (engulfing.isEngulfing) patterns.push(`engulfing_${engulfing.direction}`);
    
    if (detectInsideBar(prev, lastCandle)) patterns.push('inside_bar');
  }
  
  // Determine bias
  let biasScore = 0;
  if (trend.direction === 'up') biasScore += 2;
  if (trend.direction === 'down') biasScore -= 2;
  if (structure.trend === 'bullish') biasScore += 1;
  if (structure.trend === 'bearish') biasScore -= 1;
  if (rsi[lastIdx] && rsi[lastIdx] > 50) biasScore += 0.5;
  if (rsi[lastIdx] && rsi[lastIdx] < 50) biasScore -= 0.5;
  
  let bias: 'bullish' | 'bearish' | 'neutral';
  if (biasScore >= 2) bias = 'bullish';
  else if (biasScore <= -2) bias = 'bearish';
  else bias = 'neutral';
  
  const confidence = Math.min(100, Math.abs(biasScore) * 20);
  
  return {
    timeframe,
    role,
    trend,
    structure,
    srLevels,
    rsi: rsi[lastIdx] || 50,
    atr: atr[atr.length - 1] || 0,
    ema20: ema20[lastIdx] || 0,
    ema50: ema50[lastIdx] || 0,
    ema200: ema200[lastIdx] || 0,
    lastCandle,
    patterns,
    bias,
    confidence
  };
}

export function performMultiTimeframeAnalysis(
  data: Record<string, Candle[]>,
  symbol: string
): MultiTimeframeResult {
  const timeframeRoles: Record<string, TimeframeRole> = {
    'D': 'trend_direction',
    'H4': 'key_support_resistance',
    'H1': 'entry_setup',
    'M15': 'confirmation',
    'M5': 'scalp_execution',
    'M1': 'scalp_execution'
  };
  
  const analyses: Record<string, TimeframeAnalysis> = {};
  const reasoning: string[] = [];
  
  // Analyze each timeframe
  for (const [tf, candles] of Object.entries(data)) {
    if (candles.length < 50) continue; // need minimum data
    analyses[tf] = analyzeTimeframe(candles, tf, timeframeRoles[tf] || 'confirmation');
  }
  
  // Determine overall bias from higher timeframes
  let overallScore = 0;
  const weights: Record<string, number> = { D: 3, H4: 2.5, H1: 2, M15: 1, M5: 0.5 };
  
  for (const [tf, analysis] of Object.entries(analyses)) {
    const weight = weights[tf] || 1;
    if (analysis.bias === 'bullish') overallScore += weight;
    else if (analysis.bias === 'bearish') overallScore -= weight;
  }
  
  let overallBias: MultiTimeframeResult['overallBias'];
  if (overallScore >= 5) overallBias = 'strong_bullish';
  else if (overallScore >= 2) overallBias = 'bullish';
  else if (overallScore <= -5) overallBias = 'strong_bearish';
  else if (overallScore <= -2) overallBias = 'bearish';
  else overallBias = 'neutral';
  
  // Build reasoning
  if (analyses.D) {
    reasoning.push(`📅 Daily: ${analyses.D.trend.direction} trend (${analyses.D.trend.strength}), Phase: ${analyses.D.trend.phase}`);
  }
  if (analyses.H4) {
    reasoning.push(`⏰ H4: Bias ${analyses.H4.bias}, ${analyses.H4.srLevels.length} S/R levels identified`);
  }
  if (analyses.H1) {
    reasoning.push(`🕐 H1: ${analyses.H1.patterns.length > 0 ? `Patterns: ${analyses.H1.patterns.join(', ')}` : 'No clear pattern yet'}`);
  }
  if (analyses.M15) {
    reasoning.push(`⏱️ M15: RSI=${analyses.M15.rsi.toFixed(1)}, Bias: ${analyses.M15.bias}`);
  }
  
  // Generate signal if confluence is sufficient
  const confluenceScore = calculateConfluence(analyses, overallBias);
  let signal: TradeSignal | null = null;
  
  if (confluenceScore >= 5 && analyses.H1) {
    signal = generateSignal(analyses, overallBias, confluenceScore);
    if (signal) {
      reasoning.push(`🎯 SIGNAL: ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)}`);
      reasoning.push(`   SL: ${signal.stopLoss.toFixed(2)} | TP1: ${signal.takeProfit1.toFixed(2)} | TP2: ${signal.takeProfit2.toFixed(2)}`);
      reasoning.push(`   Grade: ${signal.grade} | RR: 1:${signal.riskRewardRatio.toFixed(1)}`);
    }
  } else {
    reasoning.push(`⏸️ No signal - confluence score ${confluenceScore}/10 (need 5+)`);
  }
  
  return {
    symbol,
    timestamp: Date.now(),
    analyses,
    overallBias,
    confluenceScore,
    signal,
    reasoning
  };
}

function calculateConfluence(
  analyses: Record<string, TimeframeAnalysis>,
  overallBias: string
): number {
  let score = 0;
  
  // Trend alignment (2 points)
  if (analyses.D && analyses.H1) {
    if (analyses.D.bias === analyses.H1.bias && analyses.D.bias !== 'neutral') score += 2;
    else if (analyses.D.bias !== 'neutral' && analyses.H1.bias === 'neutral') score += 1;
  }
  
  // S/R level (2 points)
  if (analyses.H4 && analyses.H1) {
    const price = analyses.H1.lastCandle.close;
    const nearSR = analyses.H4.srLevels.find(sr => 
      Math.abs(sr.level - price) / price < 0.005 // within 0.5%
    );
    if (nearSR) score += 2;
  }
  
  // Candle pattern (1 point)
  if (analyses.H1 && analyses.H1.patterns.length > 0) score += 1;
  
  // EMA support (1 point)
  if (analyses.H1) {
    const price = analyses.H1.lastCandle.close;
    const nearEMA = Math.abs(price - analyses.H1.ema20) / price < 0.003;
    if (nearEMA) score += 1;
  }
  
  // Momentum (RSI alignment) (1 point)
  if (analyses.M15) {
    if (overallBias.includes('bullish') && analyses.M15.rsi > 40 && analyses.M15.rsi < 70) score += 1;
    if (overallBias.includes('bearish') && analyses.M15.rsi < 60 && analyses.M15.rsi > 30) score += 1;
  }
  
  // Multi-TF agreement (2 points)
  const biases = Object.values(analyses).map(a => a.bias);
  const bullishCount = biases.filter(b => b === 'bullish').length;
  const bearishCount = biases.filter(b => b === 'bearish').length;
  if (bullishCount >= 3 || bearishCount >= 3) score += 2;
  else if (bullishCount >= 2 || bearishCount >= 2) score += 1;
  
  return Math.min(10, score);
}

function generateSignal(
  analyses: Record<string, TimeframeAnalysis>,
  overallBias: string,
  confluenceScore: number
): TradeSignal | null {
  const h1 = analyses.H1;
  if (!h1) return null;
  
  const direction: 'long' | 'short' = overallBias.includes('bullish') ? 'long' : 'short';
  const price = h1.lastCandle.close;
  const atr = h1.atr;
  
  if (atr === 0) return null;
  
  let stopLoss: number;
  let takeProfit1: number;
  let takeProfit2: number;
  let takeProfit3: number;
  
  if (direction === 'long') {
    stopLoss = price - atr * 1.5;
    takeProfit1 = price + atr * 2;
    takeProfit2 = price + atr * 3;
    takeProfit3 = price + atr * 5;
  } else {
    stopLoss = price + atr * 1.5;
    takeProfit1 = price - atr * 2;
    takeProfit2 = price - atr * 3;
    takeProfit3 = price - atr * 5;
  }
  
  const risk = Math.abs(price - stopLoss);
  const reward = Math.abs(takeProfit2 - price);
  const riskRewardRatio = reward / risk;
  
  // Grade based on confluence
  let grade: 'A' | 'B' | 'C';
  if (confluenceScore >= 8) grade = 'A';
  else if (confluenceScore >= 6) grade = 'B';
  else grade = 'C';
  
  const confluenceFactors: string[] = [];
  if (analyses.D?.bias === direction.replace('long', 'bullish').replace('short', 'bearish')) {
    confluenceFactors.push('Daily trend alignment');
  }
  if (h1.patterns.length > 0) confluenceFactors.push(`Pattern: ${h1.patterns[0]}`);
  if (analyses.H4?.srLevels.length) confluenceFactors.push('Near H4 S/R level');
  
  return {
    direction,
    entry: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskRewardRatio,
    grade,
    setup: h1.patterns[0] || 'trend_continuation',
    confluenceFactors,
    invalidation: `Price closes ${direction === 'long' ? 'below' : 'above'} ${stopLoss.toFixed(2)}`
  };
}
