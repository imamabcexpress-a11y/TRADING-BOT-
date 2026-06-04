/**
 * Knowledge Base - Combined wisdom from all trading references
 * This is the "brain" of the trading bot agent
 */

export * from './trading-in-the-zone.js';
export * from './price-action-scalping.js';
export * from './art-science-technical-analysis.js';
export * from './forex-factory-calendar.js';

// Master Trading Rules - synthesized from all books
export const MASTER_TRADING_RULES = {
  // Rule Priority Order
  priority: [
    "1. Psychology first (Trading in the Zone) - Am I in the right state?",
    "2. News check (Forex Factory) - Any high-impact events?",
    "3. Multi-timeframe alignment (Art & Science) - What's the bigger picture?",
    "4. Setup identification (Price Action Scalping) - Is there a valid setup?",
    "5. Risk management - Is the risk/reward acceptable?",
    "6. Execution - Enter with precision on lower timeframe"
  ],

  // Confluence Scoring
  confluenceFactors: {
    trendAlignment: 2,     // Higher TF trend agrees with trade direction
    srLevel: 2,            // At a key S/R level
    candlePattern: 1,      // Reversal/continuation pattern present
    emaSupport: 1,         // Price at a key EMA
    volumeConfirm: 1,      // Volume supports the move
    momentumAlign: 1,      // RSI/momentum in agreement
    newsContext: 1,        // Fundamental backdrop supports
    sessionTiming: 1       // In active trading session
  },
  
  // Minimum confluence score to take a trade
  minimumConfluence: 5,    // Out of 10 possible points
  
  // Trade Grading
  grading: {
    A: { minConfluence: 8, riskMultiplier: 1.5, description: "A+ setup - increase size" },
    B: { minConfluence: 6, riskMultiplier: 1.0, description: "Standard setup - normal size" },
    C: { minConfluence: 5, riskMultiplier: 0.5, description: "Marginal setup - reduce size" },
    noTrade: { minConfluence: 0, riskMultiplier: 0, description: "Below threshold - skip" }
  }
};
