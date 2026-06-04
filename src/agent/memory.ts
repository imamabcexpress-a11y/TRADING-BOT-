/**
 * Memory System - Persistent storage for the trading bot agent
 * Stores trade history, lessons learned, market observations, and performance metrics
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = join(process.cwd(), 'memory');

export interface TradeRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number | null;
  exitTimestamp: number | null;
  result: 'win' | 'loss' | 'breakeven' | 'open';
  pnlR: number | null; // profit in R multiples
  pnlPercent: number | null;
  setup: string;
  grade: 'A' | 'B' | 'C';
  confluenceScore: number;
  timeframe: string;
  notes: string;
  lessons: string[];
}

export interface MarketObservation {
  id: string;
  timestamp: number;
  symbol: string;
  observation: string;
  category: 'pattern' | 'behavior' | 'level' | 'correlation' | 'news_reaction';
  importance: 'high' | 'medium' | 'low';
}

export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averageRR: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  averageHoldingTime: number;
  setupPerformance: Record<string, { wins: number; losses: number; avgRR: number }>;
  gradePerformance: Record<string, { wins: number; losses: number; avgRR: number }>;
  timeframePerformance: Record<string, { wins: number; losses: number; avgRR: number }>;
}

export interface LessonLearned {
  id: string;
  timestamp: number;
  category: 'psychology' | 'technical' | 'risk_management' | 'execution' | 'market_behavior';
  lesson: string;
  context: string;
  actionItem: string;
  timesReinforced: number;
}

export interface AgentMemory {
  trades: TradeRecord[];
  observations: MarketObservation[];
  lessons: LessonLearned[];
  performance: PerformanceMetrics;
  lastAnalysis: Record<string, any>;
  dailyJournal: Array<{ date: string; notes: string; mood: string; pnl: number }>;
}

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function getFilePath(filename: string): string {
  return join(MEMORY_DIR, filename);
}

// Initialize empty memory
function createEmptyMemory(): AgentMemory {
  return {
    trades: [],
    observations: [],
    lessons: getDefaultLessons(),
    performance: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      averageRR: 0,
      bestTrade: 0,
      worstTrade: 0,
      profitFactor: 0,
      expectancy: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      averageHoldingTime: 0,
      setupPerformance: {},
      gradePerformance: {},
      timeframePerformance: {}
    },
    lastAnalysis: {},
    dailyJournal: []
  };
}

// Default lessons from books (pre-loaded knowledge)
function getDefaultLessons(): LessonLearned[] {
  return [
    {
      id: 'lesson_001',
      timestamp: Date.now(),
      category: 'psychology',
      lesson: "Never trade when emotionally compromised (revenge, fear, euphoria)",
      context: "Trading in the Zone - The trader must be in a neutral emotional state",
      actionItem: "Check emotional state before every trade. Use the kill switch system.",
      timesReinforced: 0
    },
    {
      id: 'lesson_002',
      timestamp: Date.now(),
      category: 'psychology',
      lesson: "Every trade outcome is probabilistic - focus on process, not individual results",
      context: "Trading in the Zone - Think in probabilities, not certainties",
      actionItem: "Judge success by rule-following, not by P&L of individual trades.",
      timesReinforced: 0
    },
    {
      id: 'lesson_003',
      timestamp: Date.now(),
      category: 'technical',
      lesson: "Always trade in the direction of the higher timeframe trend",
      context: "Art & Science of TA - Trend alignment provides inherent edge",
      actionItem: "Check Daily trend before taking any H1 setup. Never fight the trend.",
      timesReinforced: 0
    },
    {
      id: 'lesson_004',
      timestamp: Date.now(),
      category: 'technical',
      lesson: "Wait for price action confirmation at S/R levels, don't anticipate",
      context: "Price Action Scalping - Let the market show its hand first",
      actionItem: "Wait for candle CLOSE at key levels. No prediction-based entries.",
      timesReinforced: 0
    },
    {
      id: 'lesson_005',
      timestamp: Date.now(),
      category: 'risk_management',
      lesson: "Never risk more than 2% per trade, 6% daily maximum",
      context: "All three books emphasize capital preservation as #1 priority",
      actionItem: "Calculate position size BEFORE entry. If can't define risk, don't trade.",
      timesReinforced: 0
    },
    {
      id: 'lesson_006',
      timestamp: Date.now(),
      category: 'execution',
      lesson: "Use multi-timeframe confluence - minimum 5/10 score before entry",
      context: "Art & Science of TA + Price Action - Confluence increases probability",
      actionItem: "Run full MTF analysis. Score confluence. Only take B+ or higher grades.",
      timesReinforced: 0
    },
    {
      id: 'lesson_007',
      timestamp: Date.now(),
      category: 'market_behavior',
      lesson: "Avoid trading during high-impact news releases - stay flat 30min before/after",
      context: "Forex Factory Calendar - News creates unpredictable volatility",
      actionItem: "Check economic calendar at start of each session. Mark no-trade zones.",
      timesReinforced: 0
    },
    {
      id: 'lesson_008',
      timestamp: Date.now(),
      category: 'execution',
      lesson: "Scalping entries on M5-M1 must be confirmed by M15 and aligned with H1 setup",
      context: "Multi-TF framework - lower TF execution only when higher TF agrees",
      actionItem: "Before scalp entry: H1 setup present? M15 confirms? Then execute on M5.",
      timesReinforced: 0
    }
  ];
}

// Load memory from disk
export function loadMemory(): AgentMemory {
  ensureMemoryDir();
  const filepath = getFilePath('agent-memory.json');
  
  if (existsSync(filepath)) {
    try {
      const data = readFileSync(filepath, 'utf-8');
      return JSON.parse(data);
    } catch {
      console.log('Memory file corrupted, creating fresh memory');
      return createEmptyMemory();
    }
  }
  
  const memory = createEmptyMemory();
  saveMemory(memory);
  return memory;
}

// Save memory to disk
export function saveMemory(memory: AgentMemory): void {
  ensureMemoryDir();
  const filepath = getFilePath('agent-memory.json');
  writeFileSync(filepath, JSON.stringify(memory, null, 2));
}

// Record a trade
export function recordTrade(memory: AgentMemory, trade: TradeRecord): AgentMemory {
  memory.trades.push(trade);
  memory.performance = recalculatePerformance(memory.trades);
  saveMemory(memory);
  return memory;
}

// Add observation
export function addObservation(memory: AgentMemory, observation: MarketObservation): AgentMemory {
  memory.observations.push(observation);
  // Keep last 500 observations
  if (memory.observations.length > 500) {
    memory.observations = memory.observations.slice(-500);
  }
  saveMemory(memory);
  return memory;
}

// Add or reinforce a lesson
export function addLesson(memory: AgentMemory, lesson: LessonLearned): AgentMemory {
  const existing = memory.lessons.find(l => 
    l.lesson.toLowerCase().includes(lesson.lesson.toLowerCase().slice(0, 30))
  );
  
  if (existing) {
    existing.timesReinforced++;
    existing.timestamp = Date.now();
  } else {
    memory.lessons.push(lesson);
  }
  
  saveMemory(memory);
  return memory;
}

// Get relevant lessons for current context
export function getRelevantLessons(memory: AgentMemory, context: string): LessonLearned[] {
  const keywords = context.toLowerCase().split(' ');
  
  return memory.lessons
    .filter(lesson => {
      const lessonText = `${lesson.lesson} ${lesson.context} ${lesson.category}`.toLowerCase();
      return keywords.some(kw => lessonText.includes(kw));
    })
    .sort((a, b) => b.timesReinforced - a.timesReinforced)
    .slice(0, 5);
}

// Recalculate performance metrics
function recalculatePerformance(trades: TradeRecord[]): PerformanceMetrics {
  const closed = trades.filter(t => t.result !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  
  const totalR = closed.reduce((sum, t) => sum + (t.pnlR || 0), 0);
  const totalWinR = wins.reduce((sum, t) => sum + (t.pnlR || 0), 0);
  const totalLossR = Math.abs(losses.reduce((sum, t) => sum + (t.pnlR || 0), 0));
  
  // Max consecutive
  let maxConsWins = 0, maxConsLosses = 0, consWins = 0, consLosses = 0;
  for (const t of closed) {
    if (t.result === 'win') { consWins++; consLosses = 0; maxConsWins = Math.max(maxConsWins, consWins); }
    else if (t.result === 'loss') { consLosses++; consWins = 0; maxConsLosses = Math.max(maxConsLosses, consLosses); }
  }
  
  // Setup performance
  const setupPerf: Record<string, { wins: number; losses: number; avgRR: number }> = {};
  for (const t of closed) {
    if (!setupPerf[t.setup]) setupPerf[t.setup] = { wins: 0, losses: 0, avgRR: 0 };
    if (t.result === 'win') setupPerf[t.setup].wins++;
    else setupPerf[t.setup].losses++;
  }
  
  // Grade performance
  const gradePerf: Record<string, { wins: number; losses: number; avgRR: number }> = {};
  for (const t of closed) {
    if (!gradePerf[t.grade]) gradePerf[t.grade] = { wins: 0, losses: 0, avgRR: 0 };
    if (t.result === 'win') gradePerf[t.grade].wins++;
    else gradePerf[t.grade].losses++;
  }
  
  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: closed.filter(t => t.result === 'breakeven').length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    averageRR: closed.length > 0 ? totalR / closed.length : 0,
    bestTrade: closed.length > 0 ? Math.max(...closed.map(t => t.pnlR || 0)) : 0,
    worstTrade: closed.length > 0 ? Math.min(...closed.map(t => t.pnlR || 0)) : 0,
    profitFactor: totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? Infinity : 0,
    expectancy: closed.length > 0 ? totalR / closed.length : 0,
    maxConsecutiveWins: maxConsWins,
    maxConsecutiveLosses: maxConsLosses,
    averageHoldingTime: 0, // TODO
    setupPerformance: setupPerf,
    gradePerformance: gradePerf,
    timeframePerformance: {}
  };
}

// Get performance summary as text
export function getPerformanceSummary(memory: AgentMemory): string {
  const p = memory.performance;
  if (p.totalTrades === 0) return "No trades recorded yet. Memory is fresh.";
  
  return `
📊 PERFORMANCE SUMMARY
━━━━━━━━━━━━━━━━━━━━━
Total Trades: ${p.totalTrades}
Win Rate: ${(p.winRate * 100).toFixed(1)}%
Wins/Losses: ${p.wins}W / ${p.losses}L
Avg RR: ${p.averageRR.toFixed(2)}R
Best Trade: +${p.bestTrade.toFixed(2)}R
Worst Trade: ${p.worstTrade.toFixed(2)}R
Profit Factor: ${p.profitFactor === Infinity ? '∞' : p.profitFactor.toFixed(2)}
Expectancy: ${p.expectancy.toFixed(2)}R per trade
Max Consecutive Wins: ${p.maxConsecutiveWins}
Max Consecutive Losses: ${p.maxConsecutiveLosses}
━━━━━━━━━━━━━━━━━━━━━`;
}
