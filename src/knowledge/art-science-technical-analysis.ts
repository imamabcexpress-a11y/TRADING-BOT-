/**
 * THE ART AND SCIENCE OF TECHNICAL ANALYSIS - Adam Grimes
 * Market Structure, Technical Patterns & Statistical Edge
 * 
 * Core: Combining rigorous statistical thinking with market structure reading.
 * Patterns work because of the psychology behind them, not magic.
 */

export interface SupportResistance {
  level: number;
  type: 'support' | 'resistance';
  strength: number; // 1-5 based on touches and timeframe
  touches: number;
  timeframe: string;
  lastTested: number; // timestamp
  isZone: boolean;
  zoneHigh?: number;
  zoneLow?: number;
}

export interface TrendAnalysis {
  direction: 'up' | 'down' | 'sideways';
  strength: 'strong' | 'moderate' | 'weak';
  phase: 'impulse' | 'correction' | 'accumulation' | 'distribution';
  emaAlignment: boolean; // are EMAs stacked in order
  momentum: 'increasing' | 'decreasing' | 'neutral';
}

// Adam Grimes' Market Structure Framework
export const MARKET_STRUCTURE_FRAMEWORK = {
  trendDefinition: {
    uptrend: "Higher highs AND higher lows - buying pressure dominant",
    downtrend: "Lower lows AND lower highs - selling pressure dominant",
    range: "Neither making new highs nor new lows - equilibrium",
    transition: "Breaking structure - trend change in progress"
  },

  trendPhases: {
    accumulation: {
      description: "Smart money buying after downtrend, appears as range",
      characteristics: ["Volume decreasing on drops", "Narrowing range", "Springs/false breaks below"],
      tradingApproach: "Wait for breakout confirmation, or buy springs"
    },
    markup: {
      description: "Price trending up with clear momentum",
      characteristics: ["Higher highs/lows", "Pullbacks are shallow", "Volume on up moves"],
      tradingApproach: "Buy pullbacks to moving averages or broken resistance"
    },
    distribution: {
      description: "Smart money selling after uptrend, appears as range",
      characteristics: ["Volume increasing on rallies", "Failing to make new highs", "Upthrusts"],
      tradingApproach: "Wait for breakdown confirmation, or sell upthrusts"
    },
    markdown: {
      description: "Price trending down with clear momentum",
      characteristics: ["Lower lows/highs", "Rallies are weak", "Volume on down moves"],
      tradingApproach: "Sell rallies to moving averages or broken support"
    }
  },

  // Support & Resistance Principles
  srPrinciples: {
    formation: [
      "S/R forms at previous swing highs/lows",
      "Round numbers create psychological S/R",
      "High volume areas become S/R (volume profile)",
      "Gap levels become S/R",
      "Moving averages (especially 20, 50, 200) act as dynamic S/R"
    ],
    strength: [
      "More touches = stronger level",
      "Higher timeframe levels > lower timeframe levels",
      "Recent levels > old levels",
      "Levels with volume confirmation > low volume levels",
      "S/R from multiple timeframes converging = very strong"
    ],
    polarity: "Broken support becomes resistance and vice versa",
    zones: "S/R is best thought of as a ZONE, not an exact line"
  },

  // Pattern Trading with Statistical Edge
  patterns: {
    highProbability: {
      pullbackInTrend: {
        winRate: "55-65%",
        description: "Buying pullback to support in uptrend (or selling rally to resistance in downtrend)",
        edge: "Trading with the trend provides inherent edge",
        keyFactors: ["Trend alignment", "S/R confluence", "Momentum confirmation"]
      },
      breakoutRetest: {
        winRate: "50-60%",
        description: "Trading the retest of a broken level",
        edge: "Polarity principle - broken S becomes R and vice versa",
        keyFactors: ["Clean break first", "Volume on break", "Pullback on low volume"]
      },
      failedBreakout: {
        winRate: "55-65%",
        description: "Fading a false breakout (bull/bear trap)",
        edge: "Trapped traders must exit, fueling the move against them",
        keyFactors: ["Quick reversal back inside range", "High volume on fake break", "Divergence"]
      }
    },
    
    avoidPatterns: [
      "Trading against strong trends",
      "Breakouts in choppy/ranging markets without confirmation",
      "Patterns without volume confirmation",
      "Trading in the middle of a range (no edge)"
    ]
  }
};

// Technical Indicator Framework (used to CONFIRM, not generate signals)
export const INDICATOR_FRAMEWORK = {
  movingAverages: {
    ema20: { role: "Short-term trend and dynamic S/R", timeframe: "all" },
    ema50: { role: "Medium-term trend filter", timeframe: "H1+" },
    ema200: { role: "Long-term trend direction", timeframe: "H4+" },
    alignment: "When 20 > 50 > 200 = bullish, opposite = bearish",
    crossovers: "Useful for trend change confirmation, NOT entry signals alone"
  },
  
  rsi: {
    period: 14,
    overbought: 70,
    oversold: 30,
    usage: [
      "Divergence with price = potential reversal",
      "NOT useful alone as buy/sell signal",
      "In strong trends, can stay overbought/oversold for extended periods",
      "Best used for divergence and range-bound extremes"
    ]
  },
  
  atr: {
    period: 14,
    usage: [
      "Measure volatility for stop loss placement",
      "1.5x ATR = minimum stop loss distance",
      "When ATR expanding = increased volatility, widen stops",
      "When ATR contracting = consolidation, breakout coming"
    ]
  },
  
  volume: {
    usage: [
      "Volume confirms price moves",
      "Breakout + high volume = real",
      "Breakout + low volume = likely false",
      "Trend move + decreasing volume = exhaustion coming",
      "Climactic volume at extreme = potential reversal"
    ]
  }
};

// Grimes' Trading Edge Calculation
export function calculateEdge(
  winRate: number, // 0.0 to 1.0
  averageWin: number,
  averageLoss: number
): { expectancy: number; edgePerTrade: number; description: string } {
  const expectancy = (winRate * averageWin) - ((1 - winRate) * averageLoss);
  const edgePerTrade = expectancy / averageLoss; // expressed in R
  
  let description: string;
  if (expectancy > 0) {
    description = `Positive edge: +${edgePerTrade.toFixed(2)}R per trade. System is profitable over time.`;
  } else if (expectancy === 0) {
    description = "Breakeven edge. Need to improve win rate or RR ratio.";
  } else {
    description = `Negative edge: ${edgePerTrade.toFixed(2)}R per trade. System loses money over time.`;
  }
  
  return { expectancy, edgePerTrade, description };
}

// S/R Level Detection
export function findSupportResistanceLevels(
  candles: Array<{ high: number; low: number; close: number; volume: number; timestamp: number }>,
  timeframe: string
): SupportResistance[] {
  const levels: SupportResistance[] = [];
  const tolerance = 0.002; // 0.2% zone tolerance
  
  // Find swing highs and lows
  for (let i = 2; i < candles.length - 2; i++) {
    const isSwingHigh = candles[i].high >= candles[i-1].high &&
                        candles[i].high >= candles[i-2].high &&
                        candles[i].high >= candles[i+1].high &&
                        candles[i].high >= candles[i+2].high;
    
    const isSwingLow = candles[i].low <= candles[i-1].low &&
                       candles[i].low <= candles[i-2].low &&
                       candles[i].low <= candles[i+1].low &&
                       candles[i].low <= candles[i+2].low;
    
    if (isSwingHigh) {
      // Check if near existing level
      const existing = levels.find(l => 
        l.type === 'resistance' && 
        Math.abs(l.level - candles[i].high) / l.level < tolerance
      );
      
      if (existing) {
        existing.touches++;
        existing.strength = Math.min(5, existing.touches);
        existing.lastTested = candles[i].timestamp;
      } else {
        levels.push({
          level: candles[i].high,
          type: 'resistance',
          strength: 1,
          touches: 1,
          timeframe,
          lastTested: candles[i].timestamp,
          isZone: true,
          zoneHigh: candles[i].high * (1 + tolerance / 2),
          zoneLow: candles[i].high * (1 - tolerance / 2)
        });
      }
    }
    
    if (isSwingLow) {
      const existing = levels.find(l => 
        l.type === 'support' && 
        Math.abs(l.level - candles[i].low) / l.level < tolerance
      );
      
      if (existing) {
        existing.touches++;
        existing.strength = Math.min(5, existing.touches);
        existing.lastTested = candles[i].timestamp;
      } else {
        levels.push({
          level: candles[i].low,
          type: 'support',
          strength: 1,
          touches: 1,
          timeframe,
          lastTested: candles[i].timestamp,
          isZone: true,
          zoneHigh: candles[i].low * (1 + tolerance / 2),
          zoneLow: candles[i].low * (1 - tolerance / 2)
        });
      }
    }
  }
  
  // Sort by strength
  return levels.sort((a, b) => b.strength - a.strength);
}

// Trend Analysis using EMA alignment + structure
export function analyzeTrend(
  candles: Array<{ close: number; high: number; low: number }>,
  ema20: number[],
  ema50: number[],
  ema200: number[]
): TrendAnalysis {
  const lastIdx = candles.length - 1;
  const price = candles[lastIdx].close;
  
  const e20 = ema20[lastIdx];
  const e50 = ema50[lastIdx];
  const e200 = ema200[lastIdx];
  
  // EMA alignment
  const bullishAlignment = e20 > e50 && e50 > e200;
  const bearishAlignment = e20 < e50 && e50 < e200;
  const emaAlignment = bullishAlignment || bearishAlignment;
  
  // Direction
  let direction: 'up' | 'down' | 'sideways';
  if (bullishAlignment && price > e20) direction = 'up';
  else if (bearishAlignment && price < e20) direction = 'down';
  else direction = 'sideways';
  
  // Strength
  let strength: 'strong' | 'moderate' | 'weak';
  if (emaAlignment && Math.abs(e20 - e50) / e50 > 0.02) strength = 'strong';
  else if (emaAlignment) strength = 'moderate';
  else strength = 'weak';
  
  // Phase determination
  let phase: 'impulse' | 'correction' | 'accumulation' | 'distribution';
  if (direction === 'up' && price > e20) phase = 'impulse';
  else if (direction === 'up' && price < e20 && price > e50) phase = 'correction';
  else if (direction === 'down' && price < e20) phase = 'impulse';
  else if (direction === 'down' && price > e20 && price < e50) phase = 'correction';
  else if (direction === 'sideways' && ema200.length > 1 && e200 < ema200[lastIdx - 20]) phase = 'accumulation';
  else phase = 'distribution';
  
  // Momentum (comparing recent EMA slope)
  let momentum: 'increasing' | 'decreasing' | 'neutral';
  if (ema20.length > 5) {
    const recentSlope = e20 - ema20[lastIdx - 5];
    const prevSlope = ema20[lastIdx - 5] - ema20[lastIdx - 10];
    if (Math.abs(recentSlope) > Math.abs(prevSlope) * 1.2) momentum = 'increasing';
    else if (Math.abs(recentSlope) < Math.abs(prevSlope) * 0.8) momentum = 'decreasing';
    else momentum = 'neutral';
  } else {
    momentum = 'neutral';
  }
  
  return { direction, strength, phase, emaAlignment, momentum };
}
