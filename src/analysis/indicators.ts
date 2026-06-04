/**
 * Technical Indicators - Pure implementation without external dependencies
 */

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Exponential Moving Average
export function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // First EMA value is SMA
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  ema[period - 1] = sum / period;
  
  // Calculate remaining EMAs
  for (let i = period; i < data.length; i++) {
    ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  
  return ema;
}

// Simple Moving Average
export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    sma[i] = sum / period;
  }
  return sma;
}

// RSI (Relative Strength Index)
export function calculateRSI(closes: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // First average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  // Remaining values using smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rsi[i + 1] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  
  return rsi;
}

// ATR (Average True Range)
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const tr: number[] = [];
  const atr: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    tr.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }
  
  // First ATR is simple average
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) {
    sum += tr[i];
  }
  atr[period - 1] = sum / period;
  
  // Smoothed ATR
  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  return atr;
}

// MACD
export function calculateMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  
  const macd: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastEMA[i] !== undefined && slowEMA[i] !== undefined) {
      macd[i] = fastEMA[i] - slowEMA[i];
    }
  }
  
  const validMacd = macd.filter(v => v !== undefined);
  const signal = calculateEMA(validMacd, signalPeriod);
  
  const histogram: number[] = [];
  for (let i = 0; i < validMacd.length; i++) {
    if (signal[i] !== undefined) {
      histogram[i] = validMacd[i] - signal[i];
    }
  }
  
  return { macd, signal, histogram };
}

// Bollinger Bands
export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
} {
  const middle = calculateSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  
  for (let i = period - 1; i < closes.length; i++) {
    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSquares += Math.pow(closes[j] - middle[i], 2);
    }
    const std = Math.sqrt(sumSquares / period);
    upper[i] = middle[i] + stdDev * std;
    lower[i] = middle[i] - stdDev * std;
    bandwidth[i] = (upper[i] - lower[i]) / middle[i];
  }
  
  return { upper, middle, lower, bandwidth };
}

// Volume Weighted Average Price (VWAP) - intraday
export function calculateVWAP(candles: Candle[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativeTPV += typicalPrice * candles[i].volume;
    cumulativeVolume += candles[i].volume;
    vwap[i] = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;
  }
  
  return vwap;
}

// Stochastic RSI
export function calculateStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): {
  k: number[];
  d: number[];
} {
  const rsi = calculateRSI(closes, rsiPeriod);
  const validRsi = rsi.filter(v => v !== undefined);
  
  const k: number[] = [];
  for (let i = stochPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    k[i] = max === min ? 50 : ((validRsi[i] - min) / (max - min)) * 100;
  }
  
  const d = calculateSMA(k.filter(v => v !== undefined), 3);
  
  return { k, d };
}

// Pivot Points (for S/R)
export function calculatePivotPoints(prevCandle: Candle): {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
} {
  const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
  const r1 = 2 * pivot - prevCandle.low;
  const s1 = 2 * pivot - prevCandle.high;
  const r2 = pivot + (prevCandle.high - prevCandle.low);
  const s2 = pivot - (prevCandle.high - prevCandle.low);
  const r3 = prevCandle.high + 2 * (pivot - prevCandle.low);
  const s3 = prevCandle.low - 2 * (prevCandle.high - pivot);
  
  return { pivot, r1, r2, r3, s1, s2, s3 };
}

// Fibonacci Retracement Levels
export function calculateFibLevels(swingHigh: number, swingLow: number, direction: 'up' | 'down'): {
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
} {
  const diff = swingHigh - swingLow;
  
  if (direction === 'up') {
    // Retracement in an uptrend (measuring from high)
    return {
      level236: swingHigh - diff * 0.236,
      level382: swingHigh - diff * 0.382,
      level500: swingHigh - diff * 0.5,
      level618: swingHigh - diff * 0.618,
      level786: swingHigh - diff * 0.786
    };
  } else {
    // Retracement in a downtrend (measuring from low)
    return {
      level236: swingLow + diff * 0.236,
      level382: swingLow + diff * 0.382,
      level500: swingLow + diff * 0.5,
      level618: swingLow + diff * 0.618,
      level786: swingLow + diff * 0.786
    };
  }
}
