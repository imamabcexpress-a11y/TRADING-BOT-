/**
 * FOREX PRICE ACTION SCALPING - Bob Volman
 * Pure Price Action Scalping Framework
 * 
 * Core: Read price action without indicators, identify setups through
 * candle patterns, support/resistance, and market structure on lower timeframes.
 */

export type CandlePattern = 
  | 'pin_bar'
  | 'engulfing_bullish'
  | 'engulfing_bearish'
  | 'inside_bar'
  | 'outside_bar'
  | 'doji'
  | 'hammer'
  | 'shooting_star'
  | 'morning_star'
  | 'evening_star'
  | 'three_white_soldiers'
  | 'three_black_crows'
  | 'tweezer_top'
  | 'tweezer_bottom';

export type ScalpSetup =
  | 'DD' // Double Doji Break
  | 'FB' // First Break
  | 'SB' // Second Break
  | 'BB' // Block Break
  | 'RB' // Range Break
  | 'IRB' // Inside Range Break
  | 'ARB'; // Advanced Range Break

export interface PriceActionCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  isBullish: boolean;
  isBearish: boolean;
  isDoji: boolean;
}

export interface ScalpSignal {
  setup: ScalpSetup;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 0-100
  reason: string;
  timeframe: string;
}

// Volman's 7 Scalping Setups
export const SCALP_SETUPS = {
  DD: {
    name: "Double Doji Break",
    description: "Two consecutive doji/small candles followed by a breakout candle",
    rules: [
      "Identify two consecutive small-bodied candles (doji-like)",
      "Wait for a breakout candle that closes beyond the range",
      "Enter on close of breakout candle",
      "Stop loss below/above the doji cluster",
      "Target 1:1.5 to 1:2 RR"
    ],
    bestContext: "Works best in trending markets during pullback pauses"
  },
  FB: {
    name: "First Break",
    description: "First break of a support/resistance level after a trend",
    rules: [
      "Identify clear S/R level that has been tested",
      "Wait for first convincing break (candle close beyond)",
      "Enter on the break or on pullback to level",
      "Stop loss on the other side of the broken level",
      "Target next S/R level"
    ],
    bestContext: "Best when aligned with higher timeframe trend"
  },
  SB: {
    name: "Second Break",
    description: "Second attempt to break a level after first break fails",
    rules: [
      "First break of level fails and pulls back",
      "Price returns to test the level again",
      "Second break often has more momentum",
      "Enter on second break confirmation",
      "Tighter stop possible since level was already tested"
    ],
    bestContext: "Higher probability than first break - level is weakened"
  },
  BB: {
    name: "Block Break",
    description: "Break of a price block (cluster of candles)",
    rules: [
      "Identify a block of 3-7 candles trading in a tight range",
      "Wait for a decisive break of the block high/low",
      "Volume should increase on the breakout",
      "Enter on candle close beyond the block",
      "Stop loss at the opposite side of the block"
    ],
    bestContext: "Blocks represent accumulation/distribution - breakout = direction revealed"
  },
  RB: {
    name: "Range Break",
    description: "Breakout from a defined trading range",
    rules: [
      "Range must have at least 2 touches on both high and low",
      "Wait for a candle to close decisively beyond range",
      "Confirm with increased volume",
      "Enter on close or on retest of range boundary",
      "Stop inside the range, target = range width projected"
    ],
    bestContext: "Larger ranges = more significant breakouts"
  },
  IRB: {
    name: "Inside Range Break",
    description: "Break of an inside bar that forms at S/R",
    rules: [
      "Inside bar forms at a key support or resistance level",
      "The inside bar represents indecision at a decision point",
      "Enter on break of inside bar in direction of HTF trend",
      "Stop loss at opposite end of inside bar",
      "Target: next S/R or 1:2 RR minimum"
    ],
    bestContext: "Powerful when inside bar forms at HTF S/R confluence"
  },
  ARB: {
    name: "Advanced Range Break",
    description: "Complex range break with false break preceding",
    rules: [
      "Range forms with a false breakout on one side",
      "False break traps traders on the wrong side",
      "True breakout occurs in opposite direction",
      "Enter on the true break after the false break",
      "Stop behind the false break candle"
    ],
    bestContext: "Highest probability setup - false break provides fuel for true move"
  }
};

// Price Action Reading Rules
export const PRICE_ACTION_RULES = {
  candleAnalysis: {
    bodySize: "Large body = strong conviction, small body = indecision",
    wickSize: "Long wick = rejection of price level",
    wickDirection: "Upper wick = sellers stepped in, lower wick = buyers stepped in",
    volumeConfirm: "Volume should confirm the move - high vol on breakout, low vol on pullback"
  },

  structureReading: {
    higherHighs: "Bullish structure - price making HH and HL",
    lowerLows: "Bearish structure - price making LL and LH",
    equal: "Ranging/consolidation - neither bulls nor bears in control",
    breakOfStructure: "BOS = trend change signal, needs confirmation"
  },

  entryTiming: {
    aggressive: "Enter on pattern completion (higher risk, earlier entry)",
    conservative: "Enter on retest of broken level (lower risk, may miss some trades)",
    scalping: "Enter on M1-M5 confirmation after M15 setup aligns with H1"
  },

  exitRules: {
    targetHit: "Primary exit - take profit at predefined level",
    trailingStop: "Move stop to breakeven after 1R profit, trail after",
    timeStop: "If trade doesn't move in your favor within expected time, exit",
    oppositeSignal: "If opposing signal appears, tighten stop or exit"
  }
};

// Candle pattern detection functions
export function analyzeCandleBody(candle: PriceActionCandle): string {
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return 'no_range';
  
  const bodyRatio = candle.body / totalRange;
  
  if (bodyRatio < 0.1) return 'doji';
  if (bodyRatio < 0.3) return 'small_body';
  if (bodyRatio < 0.6) return 'medium_body';
  return 'large_body';
}

export function detectPinBar(candle: PriceActionCandle): { isPin: boolean; direction: 'bullish' | 'bearish' | null } {
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return { isPin: false, direction: null };
  
  const bodyRatio = candle.body / totalRange;
  const upperWickRatio = candle.upperWick / totalRange;
  const lowerWickRatio = candle.lowerWick / totalRange;
  
  // Pin bar: small body with wick at least 2x the body
  if (bodyRatio < 0.33) {
    if (lowerWickRatio > 0.6) return { isPin: true, direction: 'bullish' };
    if (upperWickRatio > 0.6) return { isPin: true, direction: 'bearish' };
  }
  
  return { isPin: false, direction: null };
}

export function detectEngulfing(prev: PriceActionCandle, curr: PriceActionCandle): { isEngulfing: boolean; direction: 'bullish' | 'bearish' | null } {
  // Bullish engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (prev.isBearish && curr.isBullish && curr.close > prev.open && curr.open < prev.close) {
    return { isEngulfing: true, direction: 'bullish' };
  }
  
  // Bearish engulfing: prev bullish, curr bearish, curr body engulfs prev body
  if (prev.isBullish && curr.isBearish && curr.close < prev.open && curr.open > prev.close) {
    return { isEngulfing: true, direction: 'bearish' };
  }
  
  return { isEngulfing: false, direction: null };
}

export function detectInsideBar(prev: PriceActionCandle, curr: PriceActionCandle): boolean {
  return curr.high < prev.high && curr.low > prev.low;
}

export function identifyMarketStructure(candles: PriceActionCandle[]): {
  trend: 'bullish' | 'bearish' | 'ranging';
  swingHighs: number[];
  swingLows: number[];
  lastBOS: { level: number; direction: 'bullish' | 'bearish' } | null;
} {
  if (candles.length < 10) {
    return { trend: 'ranging', swingHighs: [], swingLows: [], lastBOS: null };
  }
  
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  
  // Find swing points (simple: higher than 2 candles on each side)
  for (let i = 2; i < candles.length - 2; i++) {
    const isSwingHigh = candles[i].high > candles[i-1].high && 
                        candles[i].high > candles[i-2].high &&
                        candles[i].high > candles[i+1].high && 
                        candles[i].high > candles[i+2].high;
    
    const isSwingLow = candles[i].low < candles[i-1].low && 
                       candles[i].low < candles[i-2].low &&
                       candles[i].low < candles[i+1].low && 
                       candles[i].low < candles[i+2].low;
    
    if (isSwingHigh) swingHighs.push(candles[i].high);
    if (isSwingLow) swingLows.push(candles[i].low);
  }
  
  // Determine trend from swing structure
  let trend: 'bullish' | 'bearish' | 'ranging' = 'ranging';
  
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastTwoHighs = swingHighs.slice(-2);
    const lastTwoLows = swingLows.slice(-2);
    
    const higherHighs = lastTwoHighs[1] > lastTwoHighs[0];
    const higherLows = lastTwoLows[1] > lastTwoLows[0];
    const lowerLows = lastTwoLows[1] < lastTwoLows[0];
    const lowerHighs = lastTwoHighs[1] < lastTwoHighs[0];
    
    if (higherHighs && higherLows) trend = 'bullish';
    else if (lowerLows && lowerHighs) trend = 'bearish';
  }
  
  // Find last Break of Structure
  let lastBOS = null;
  if (swingHighs.length > 0 && swingLows.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    const lastSwingLow = swingLows[swingLows.length - 1];
    
    if (lastCandle.close > lastSwingHigh) {
      lastBOS = { level: lastSwingHigh, direction: 'bullish' as const };
    } else if (lastCandle.close < lastSwingLow) {
      lastBOS = { level: lastSwingLow, direction: 'bearish' as const };
    }
  }
  
  return { trend, swingHighs, swingLows, lastBOS };
}
