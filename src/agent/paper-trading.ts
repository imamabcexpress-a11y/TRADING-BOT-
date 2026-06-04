/**
 * Paper Trading Simulation Engine
 * Simulates buy/sell execution based on signals
 * Tracks TP/SL hits, calculates W/L ratio and performance
 */

import { TradeSignal } from '../analysis/multi-timeframe.js';

export interface PaperTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  grade: string;
  setup: string;
  openTime: number;
  closeTime: number | null;
  closePrice: number | null;
  status: 'open' | 'tp1_hit' | 'tp2_hit' | 'tp3_hit' | 'sl_hit' | 'manual_close';
  pnlPercent: number | null;
  pnlR: number | null;
  riskAmount: number; // in USD based on position size
  trailingStop: number | null;
  highestPnl: number;
  lowestPnl: number;
}

export interface PaperAccount {
  balance: number;
  startingBalance: number;
  equity: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalPnL: number;
  totalPnLPercent: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  peakBalance: number;
  currentDrawdown: number;
  averageWin: number;
  averageLoss: number;
  bestTrade: number;
  worstTrade: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  expectancy: number;
  sharpeRatio: number;
  trades: PaperTrade[];
  openPositions: PaperTrade[];
}

export class PaperTradingEngine {
  private account: PaperAccount;
  private riskPerTrade: number = 0.02; // 2%
  private maxOpenPositions: number = 3;
  private useTrailingStop: boolean = true;
  private trailingActivationR: number = 1.0;

  constructor(startingBalance: number = 10000) {
    this.account = {
      balance: startingBalance,
      startingBalance,
      equity: startingBalance,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      peakBalance: startingBalance,
      currentDrawdown: 0,
      averageWin: 0,
      averageLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      expectancy: 0,
      sharpeRatio: 0,
      trades: [],
      openPositions: []
    };
  }

  // Execute a signal as a paper trade
  executeSignal(signal: TradeSignal, symbol: string): PaperTrade | null {
    // Check if we can open more positions
    if (this.account.openPositions.length >= this.maxOpenPositions) {
      return null;
    }

    // Check if already have position in same direction for same symbol
    const existing = this.account.openPositions.find(
      p => p.symbol === symbol && p.direction === signal.direction
    );
    if (existing) return null;

    // Calculate position size based on risk
    const riskAmount = this.account.balance * this.riskPerTrade;
    const riskPerUnit = Math.abs(signal.entry - signal.stopLoss);

    const trade: PaperTrade = {
      id: `PT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      symbol,
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      takeProfit3: signal.takeProfit3,
      grade: signal.grade,
      setup: signal.setup,
      openTime: Date.now(),
      closeTime: null,
      closePrice: null,
      status: 'open',
      pnlPercent: null,
      pnlR: null,
      riskAmount,
      trailingStop: null,
      highestPnl: 0,
      lowestPnl: 0
    };

    this.account.openPositions.push(trade);
    return trade;
  }

  // Update all open positions with current price (called every tick)
  updatePositions(currentPrice: number, symbol: string): PaperTrade[] {
    const closedTrades: PaperTrade[] = [];

    this.account.openPositions = this.account.openPositions.filter(trade => {
      if (trade.symbol !== symbol) return true;

      const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);
      let currentPnlR: number;

      if (trade.direction === 'long') {
        currentPnlR = (currentPrice - trade.entry) / riskPerUnit;
      } else {
        currentPnlR = (trade.entry - currentPrice) / riskPerUnit;
      }

      // Track highest/lowest PnL
      trade.highestPnl = Math.max(trade.highestPnl, currentPnlR);
      trade.lowestPnl = Math.min(trade.lowestPnl, currentPnlR);

      // Trailing stop logic
      if (this.useTrailingStop && currentPnlR >= this.trailingActivationR) {
        const trailDistance = riskPerUnit * 0.5;
        if (trade.direction === 'long') {
          const newTrail = currentPrice - trailDistance;
          if (!trade.trailingStop || newTrail > trade.trailingStop) {
            trade.trailingStop = newTrail;
          }
        } else {
          const newTrail = currentPrice + trailDistance;
          if (!trade.trailingStop || newTrail < trade.trailingStop) {
            trade.trailingStop = newTrail;
          }
        }
      }

      // Check SL / Trailing Stop
      let hitSL = false;
      if (trade.direction === 'long') {
        const effectiveSL = trade.trailingStop || trade.stopLoss;
        if (currentPrice <= effectiveSL) hitSL = true;
      } else {
        const effectiveSL = trade.trailingStop || trade.stopLoss;
        if (currentPrice >= effectiveSL) hitSL = true;
      }

      if (hitSL) {
        const closePrice = trade.trailingStop || trade.stopLoss;
        this.closeTrade(trade, closePrice, trade.trailingStop ? 'tp1_hit' : 'sl_hit');
        closedTrades.push(trade);
        return false;
      }

      // Check TP3 (best case)
      if (trade.direction === 'long' && currentPrice >= trade.takeProfit3) {
        this.closeTrade(trade, trade.takeProfit3, 'tp3_hit');
        closedTrades.push(trade);
        return false;
      }
      if (trade.direction === 'short' && currentPrice <= trade.takeProfit3) {
        this.closeTrade(trade, trade.takeProfit3, 'tp3_hit');
        closedTrades.push(trade);
        return false;
      }

      // Check TP2
      if (trade.direction === 'long' && currentPrice >= trade.takeProfit2) {
        this.closeTrade(trade, trade.takeProfit2, 'tp2_hit');
        closedTrades.push(trade);
        return false;
      }
      if (trade.direction === 'short' && currentPrice <= trade.takeProfit2) {
        this.closeTrade(trade, trade.takeProfit2, 'tp2_hit');
        closedTrades.push(trade);
        return false;
      }

      // Check TP1 - partial close (move SL to breakeven)
      if (trade.direction === 'long' && currentPrice >= trade.takeProfit1 && !trade.trailingStop) {
        trade.trailingStop = trade.entry; // Move to breakeven
      }
      if (trade.direction === 'short' && currentPrice <= trade.takeProfit1 && !trade.trailingStop) {
        trade.trailingStop = trade.entry;
      }

      return true; // Keep position open
    });

    // Update equity
    this.updateEquity(currentPrice, symbol);

    return closedTrades;
  }

  private closeTrade(trade: PaperTrade, closePrice: number, status: PaperTrade['status']): void {
    trade.closePrice = closePrice;
    trade.closeTime = Date.now();
    trade.status = status;

    const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);

    if (trade.direction === 'long') {
      trade.pnlR = (closePrice - trade.entry) / riskPerUnit;
    } else {
      trade.pnlR = (trade.entry - closePrice) / riskPerUnit;
    }

    trade.pnlPercent = (trade.pnlR * this.riskPerTrade) * 100;

    // Update account
    const pnlUSD = trade.pnlR * trade.riskAmount;
    this.account.balance += pnlUSD;
    this.account.totalPnL += pnlUSD;
    this.account.totalTrades++;
    this.account.trades.push({ ...trade });

    if (trade.pnlR > 0.1) {
      this.account.wins++;
      this.account.consecutiveWins++;
      this.account.consecutiveLosses = 0;
      this.account.maxConsecutiveWins = Math.max(this.account.maxConsecutiveWins, this.account.consecutiveWins);
    } else if (trade.pnlR < -0.1) {
      this.account.losses++;
      this.account.consecutiveLosses++;
      this.account.consecutiveWins = 0;
      this.account.maxConsecutiveLosses = Math.max(this.account.maxConsecutiveLosses, this.account.consecutiveLosses);
    } else {
      this.account.breakevens++;
    }

    // Update stats
    this.account.winRate = this.account.totalTrades > 0 ? this.account.wins / this.account.totalTrades : 0;
    this.account.totalPnLPercent = ((this.account.balance - this.account.startingBalance) / this.account.startingBalance) * 100;

    // Best/worst trade
    if (trade.pnlR !== null) {
      this.account.bestTrade = Math.max(this.account.bestTrade, trade.pnlR);
      this.account.worstTrade = Math.min(this.account.worstTrade, trade.pnlR);
    }

    // Peak balance & drawdown
    if (this.account.balance > this.account.peakBalance) {
      this.account.peakBalance = this.account.balance;
    }
    this.account.currentDrawdown = ((this.account.peakBalance - this.account.balance) / this.account.peakBalance) * 100;
    this.account.maxDrawdownPercent = Math.max(this.account.maxDrawdownPercent, this.account.currentDrawdown);
    this.account.maxDrawdown = this.account.peakBalance - this.account.balance;

    // Averages
    const wins = this.account.trades.filter(t => (t.pnlR || 0) > 0);
    const losses = this.account.trades.filter(t => (t.pnlR || 0) < 0);
    this.account.averageWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlR || 0), 0) / wins.length : 0;
    this.account.averageLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnlR || 0), 0) / losses.length) : 0;

    // Profit factor
    const totalWins = wins.reduce((s, t) => s + (t.pnlR || 0), 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnlR || 0), 0));
    this.account.profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Expectancy
    this.account.expectancy = this.account.totalTrades > 0
      ? this.account.trades.reduce((s, t) => s + (t.pnlR || 0), 0) / this.account.totalTrades
      : 0;
  }

  private updateEquity(currentPrice: number, symbol: string): void {
    let unrealizedPnL = 0;
    for (const trade of this.account.openPositions) {
      if (trade.symbol !== symbol) continue;
      const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);
      let pnlR: number;
      if (trade.direction === 'long') {
        pnlR = (currentPrice - trade.entry) / riskPerUnit;
      } else {
        pnlR = (trade.entry - currentPrice) / riskPerUnit;
      }
      unrealizedPnL += pnlR * trade.riskAmount;
    }
    this.account.equity = this.account.balance + unrealizedPnL;
  }

  // Manual close
  manualClose(tradeId: string, currentPrice: number): PaperTrade | null {
    const idx = this.account.openPositions.findIndex(t => t.id === tradeId);
    if (idx === -1) return null;
    const trade = this.account.openPositions[idx];
    this.closeTrade(trade, currentPrice, 'manual_close');
    this.account.openPositions.splice(idx, 1);
    return trade;
  }

  // Get account state
  getAccount(): PaperAccount {
    return { ...this.account };
  }

  // Get open positions
  getOpenPositions(): PaperTrade[] {
    return [...this.account.openPositions];
  }

  // Get trade history
  getTradeHistory(): PaperTrade[] {
    return [...this.account.trades];
  }

  // Reset account
  reset(balance: number = 10000): void {
    this.account = {
      balance,
      startingBalance: balance,
      equity: balance,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      peakBalance: balance,
      currentDrawdown: 0,
      averageWin: 0,
      averageLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      expectancy: 0,
      sharpeRatio: 0,
      trades: [],
      openPositions: []
    };
  }
}
