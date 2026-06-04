/**
 * FOREX FACTORY CALENDAR - News Trading Framework
 * 
 * Understanding economic calendar events and their impact on trading.
 * Rules for trading around high-impact news events.
 */

export type NewsImpact = 'high' | 'medium' | 'low';

export interface NewsEvent {
  time: string;
  currency: string;
  impact: NewsImpact;
  event: string;
  forecast?: number;
  previous?: number;
  actual?: number;
}

// High Impact Events that move markets significantly
export const HIGH_IMPACT_EVENTS = {
  USD: [
    "Non-Farm Payrolls (NFP)",
    "FOMC Interest Rate Decision",
    "FOMC Press Conference",
    "CPI (Consumer Price Index)",
    "Core CPI",
    "GDP",
    "Retail Sales",
    "PCE Price Index",
    "Initial Jobless Claims",
    "ISM Manufacturing PMI",
    "Fed Chair Powell Speaks"
  ],
  EUR: [
    "ECB Interest Rate Decision",
    "ECB Press Conference",
    "German CPI",
    "Eurozone CPI",
    "German GDP",
    "Eurozone GDP"
  ],
  GBP: [
    "BOE Interest Rate Decision",
    "UK CPI",
    "UK GDP",
    "UK Employment"
  ],
  JPY: [
    "BOJ Interest Rate Decision",
    "Japan CPI",
    "Japan GDP"
  ],
  CRYPTO: [
    "Bitcoin ETF Flow Data",
    "FOMC (affects all risk assets)",
    "CPI Data (inflation narrative)",
    "SEC Enforcement Actions",
    "Major Exchange Outages/Hacks",
    "Whale Movements (on-chain)",
    "Halving Events",
    "Protocol Upgrades"
  ]
};

// News Trading Rules
export const NEWS_TRADING_RULES = {
  beforeNews: {
    highImpact: {
      action: "CLOSE or REDUCE positions 30 minutes before",
      reason: "Unpredictable volatility, slippage, spread widening",
      exception: "Only if trade is already well in profit with tight trailing stop"
    },
    mediumImpact: {
      action: "Tighten stops, reduce size if needed",
      reason: "Can still cause significant moves",
      exception: "If aligned with your trade direction and you have buffer"
    },
    lowImpact: {
      action: "Monitor but no need to close",
      reason: "Rarely causes significant movement",
      exception: "Multiple low-impact news at same time can compound"
    }
  },

  duringNews: {
    rules: [
      "DO NOT enter new trades during the release (0-5 minutes)",
      "Spreads will be extremely wide",
      "Slippage is common - stops may not execute at your level",
      "Price can spike both directions (whipsaw) before choosing direction",
      "Wait for the dust to settle"
    ]
  },

  afterNews: {
    tradingWindow: {
      aggressive: "5-15 minutes after release (once direction is established)",
      conservative: "30-60 minutes after release (once volatility normalizes)",
      scalping: "Wait for a clear setup to form on M5-M15 after initial spike"
    },
    strategy: [
      "Identify the initial spike direction",
      "Wait for a pullback (50-61.8% of spike)",
      "Enter in the direction of the spike if pullback holds",
      "Stop loss below the pullback low (for buys) or above pullback high (for sells)",
      "Target: pre-news level or extension of the spike"
    ]
  },

  // Specific to crypto
  cryptoNewsRules: {
    etfFlows: "Persistent outflows = bearish pressure, cumulative effect over days",
    fedDecision: "Hawkish = bearish for crypto, Dovish = bullish",
    regulation: "Negative news causes immediate crash, positive news slower grind up",
    whaleAlert: "Large transfers to exchanges = potential sell pressure",
    liquidations: "Cascading liquidations amplify moves in both directions"
  }
};

// Calendar Check Function
export function shouldTrade(
  upcomingEvents: NewsEvent[],
  minutesUntilEvent: number,
  currentPosition: 'long' | 'short' | 'flat'
): {
  canTrade: boolean;
  action: string;
  reason: string;
} {
  const highImpactSoon = upcomingEvents.filter(
    e => e.impact === 'high' && minutesUntilEvent <= 30
  );
  
  if (highImpactSoon.length > 0) {
    if (currentPosition !== 'flat') {
      return {
        canTrade: false,
        action: "Close or tighten stop immediately",
        reason: `High-impact event in ${minutesUntilEvent} min: ${highImpactSoon[0].event}`
      };
    }
    return {
      canTrade: false,
      action: "Wait - do not enter new trades",
      reason: `High-impact event approaching: ${highImpactSoon[0].event}. Wait 30+ min after release.`
    };
  }
  
  const medImpactSoon = upcomingEvents.filter(
    e => e.impact === 'medium' && minutesUntilEvent <= 15
  );
  
  if (medImpactSoon.length > 0) {
    return {
      canTrade: true,
      action: "Trade with caution - reduce size",
      reason: `Medium-impact event in ${minutesUntilEvent} min: ${medImpactSoon[0].event}`
    };
  }
  
  return {
    canTrade: true,
    action: "Clear to trade",
    reason: "No significant news events in the near term"
  };
}

// Session Times (affects volatility and liquidity)
export const TRADING_SESSIONS = {
  sydney: { open: "22:00", close: "07:00", note: "Low volatility, AUD/NZD pairs active" },
  tokyo: { open: "00:00", close: "09:00", note: "Medium volatility, JPY pairs, crypto can be active" },
  london: { open: "08:00", close: "17:00", note: "Highest FX volatility, major pairs" },
  newYork: { open: "13:00", close: "22:00", note: "High volatility, USD pairs, crypto correlates with stocks" },
  londonNewYorkOverlap: { open: "13:00", close: "17:00", note: "HIGHEST volatility - best scalping window" },
  crypto247: { note: "Crypto trades 24/7 but highest volume during US/London hours" }
};
