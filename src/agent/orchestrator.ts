/**
 * Trading Bot Agent Orchestrator
 * The main brain that combines all components:
 * 1. Knowledge (books) → Rules & frameworks
 * 2. Memory → Past trades & lessons
 * 3. Data → Real-time market data from TradingView
 * 4. Analysis → Multi-timeframe technical analysis
 * 5. Psychology → Emotional state management
 * 6. Signal → Trade signal generation with confluence
 */

import { connectToTradingView, getMultiTimeframeData, RealtimeQuote, subscribeToQuotes } from '../data/tradingview-connector.js';
import { performMultiTimeframeAnalysis, MultiTimeframeResult, TradeSignal } from '../analysis/multi-timeframe.js';
import { loadMemory, saveMemory, recordTrade, addObservation, addLesson, getRelevantLessons, getPerformanceSummary, AgentMemory, TradeRecord } from './memory.js';
import { assessPsychologyState, PsychologyState, ZONE_RULES, FIVE_FUNDAMENTAL_TRUTHS } from '../knowledge/trading-in-the-zone.js';
import { MASTER_TRADING_RULES } from '../knowledge/index.js';
import { NEWS_TRADING_RULES, shouldTrade } from '../knowledge/forex-factory-calendar.js';

export interface AgentState {
  isRunning: boolean;
  symbol: string;
  lastQuote: RealtimeQuote | null;
  lastAnalysis: MultiTimeframeResult | null;
  psychology: PsychologyState;
  memory: AgentMemory;
  openTrades: TradeRecord[];
  signals: TradeSignal[];
  logs: string[];
}

export class TradingBotAgent {
  private state: AgentState;
  private connection: any = null;
  private unsubQuotes: (() => void) | null = null;
  private analysisInterval: NodeJS.Timeout | null = null;

  constructor(symbol: string = 'BINANCE:BTCUSDT') {
    this.state = {
      isRunning: false,
      symbol,
      lastQuote: null,
      lastAnalysis: null,
      psychology: {
        emotionalState: 'neutral',
        consecutiveWins: 0,
        consecutiveLosses: 0,
        dailyPnL: 0,
        isInZone: true
      },
      memory: loadMemory(),
      openTrades: [],
      signals: [],
      logs: []
    };
  }

  // Main startup sequence
  async start(): Promise<void> {
    this.log('🤖 Trading Bot Agent starting...');
    this.log('📚 Knowledge base loaded: Trading in the Zone, Price Action Scalping, Art & Science of TA');
    this.log(`🧠 Memory: ${this.state.memory.performance.totalTrades} trades, ${this.state.memory.lessons.length} lessons`);
    
    // Step 1: Psychology check
    const psychCheck = assessPsychologyState(this.state.psychology);
    if (!psychCheck.canTrade) {
      this.log(`⛔ Psychology check FAILED: ${psychCheck.reason}`);
      this.log(`💡 ${psychCheck.recommendation}`);
      return;
    }
    this.log('✅ Psychology check passed - In the zone');
    
    // Step 2: Connect to TradingView
    this.log(`📡 Connecting to TradingView for ${this.state.symbol}...`);
    try {
      this.connection = await connectToTradingView();
      this.log('✅ Connected to TradingView WebSocket');
    } catch (err) {
      this.log(`❌ Connection failed: ${err}`);
      return;
    }
    
    // Step 3: Subscribe to real-time quotes
    this.unsubQuotes = subscribeToQuotes(this.connection, [this.state.symbol], (quote) => {
      this.state.lastQuote = quote;
      this.onQuoteUpdate(quote);
    });
    this.log('📊 Subscribed to real-time quotes');
    
    // Step 4: Run initial full analysis
    await this.runFullAnalysis();
    
    // Step 5: Set up periodic analysis
    this.analysisInterval = setInterval(() => {
      this.runFullAnalysis();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    this.state.isRunning = true;
    this.log('🟢 Agent is active and monitoring');
    this.log('');
    this.log('─── MASTER RULES ───');
    MASTER_TRADING_RULES.priority.forEach(rule => this.log(`  ${rule}`));
    this.log('────────────────────');
  }

  // Run complete multi-timeframe analysis
  async runFullAnalysis(): Promise<MultiTimeframeResult | null> {
    if (!this.connection) return null;
    
    this.log(`\n🔄 Running full MTF analysis for ${this.state.symbol}...`);
    
    try {
      const mtfData = await getMultiTimeframeData(this.connection, this.state.symbol, 200);
      const analysis = performMultiTimeframeAnalysis(mtfData, this.state.symbol);
      
      this.state.lastAnalysis = analysis;
      
      // Log reasoning
      this.log('');
      this.log('═══ ANALYSIS RESULT ═══');
      analysis.reasoning.forEach(r => this.log(`  ${r}`));
      this.log(`  Overall: ${analysis.overallBias} | Confluence: ${analysis.confluenceScore}/10`);
      this.log('═══════════════════════');
      
      // Check if we have a signal
      if (analysis.signal) {
        this.onSignal(analysis.signal);
      }
      
      // Save to memory
      this.state.memory.lastAnalysis = {
        timestamp: Date.now(),
        result: analysis.overallBias,
        confluence: analysis.confluenceScore,
        hasSignal: !!analysis.signal
      };
      saveMemory(this.state.memory);
      
      return analysis;
    } catch (err) {
      this.log(`❌ Analysis failed: ${err}`);
      return null;
    }
  }

  // Handle new signal
  private onSignal(signal: TradeSignal): void {
    this.log('');
    this.log('🎯 ════════════ NEW SIGNAL ════════════');
    this.log(`  Direction: ${signal.direction.toUpperCase()}`);
    this.log(`  Entry: ${signal.entry.toFixed(2)}`);
    this.log(`  Stop Loss: ${signal.stopLoss.toFixed(2)}`);
    this.log(`  TP1: ${signal.takeProfit1.toFixed(2)}`);
    this.log(`  TP2: ${signal.takeProfit2.toFixed(2)}`);
    this.log(`  TP3: ${signal.takeProfit3.toFixed(2)}`);
    this.log(`  R:R = 1:${signal.riskRewardRatio.toFixed(1)}`);
    this.log(`  Grade: ${signal.grade}`);
    this.log(`  Setup: ${signal.setup}`);
    this.log(`  Confluence: ${signal.confluenceFactors.join(', ')}`);
    this.log(`  Invalidation: ${signal.invalidation}`);
    this.log('  ════════════════════════════════════');
    
    // Apply Trading in the Zone principles
    this.log('');
    this.log('  🧠 Zone Check:');
    this.log(`  ✓ "${FIVE_FUNDAMENTAL_TRUTHS[2]}"`);
    this.log(`  ✓ Risk predefined: SL @ ${signal.stopLoss.toFixed(2)}`);
    this.log(`  ✓ Accepting risk completely`);
    
    // Check against relevant lessons
    const lessons = getRelevantLessons(this.state.memory, signal.setup + ' ' + signal.direction);
    if (lessons.length > 0) {
      this.log('  📖 Relevant lessons:');
      lessons.forEach(l => this.log(`    - ${l.lesson}`));
    }
    
    this.state.signals.push(signal);
  }

  // Handle real-time quote updates
  private onQuoteUpdate(quote: RealtimeQuote): void {
    // Check if any open trades need management
    for (const trade of this.state.openTrades) {
      if (trade.direction === 'long') {
        if (quote.price <= trade.stopLoss) {
          this.closeTrade(trade, quote.price, 'stop_hit');
        } else if (quote.price >= trade.takeProfit) {
          this.closeTrade(trade, quote.price, 'tp_hit');
        }
      } else {
        if (quote.price >= trade.stopLoss) {
          this.closeTrade(trade, quote.price, 'stop_hit');
        } else if (quote.price <= trade.takeProfit) {
          this.closeTrade(trade, quote.price, 'tp_hit');
        }
      }
    }
  }

  // Close a trade
  private closeTrade(trade: TradeRecord, exitPrice: number, reason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTimestamp = Date.now();
    
    const risk = Math.abs(trade.entry - trade.stopLoss);
    const pnl = trade.direction === 'long' 
      ? exitPrice - trade.entry 
      : trade.entry - exitPrice;
    
    trade.pnlR = pnl / risk;
    trade.pnlPercent = (pnl / trade.entry) * 100;
    trade.result = trade.pnlR > 0.1 ? 'win' : trade.pnlR < -0.1 ? 'loss' : 'breakeven';
    
    this.log(`\n📋 Trade closed: ${trade.result.toUpperCase()} | ${trade.pnlR?.toFixed(2)}R | Reason: ${reason}`);
    
    // Update psychology state
    if (trade.result === 'win') {
      this.state.psychology.consecutiveWins++;
      this.state.psychology.consecutiveLosses = 0;
    } else if (trade.result === 'loss') {
      this.state.psychology.consecutiveLosses++;
      this.state.psychology.consecutiveWins = 0;
    }
    this.state.psychology.dailyPnL += trade.pnlPercent || 0;
    
    // Record to memory
    recordTrade(this.state.memory, trade);
    
    // Remove from open trades
    this.state.openTrades = this.state.openTrades.filter(t => t.id !== trade.id);
  }

  // Stop the agent
  async stop(): Promise<void> {
    this.log('🛑 Stopping agent...');
    
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.unsubQuotes) this.unsubQuotes();
    if (this.connection) await this.connection.close();
    
    this.state.isRunning = false;
    saveMemory(this.state.memory);
    this.log('Agent stopped. Memory saved.');
  }

  // Logging
  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    this.state.logs.push(entry);
    console.log(entry);
  }

  // Get current state
  getState(): AgentState {
    return { ...this.state };
  }

  // Get performance summary
  getPerformance(): string {
    return getPerformanceSummary(this.state.memory);
  }
}
