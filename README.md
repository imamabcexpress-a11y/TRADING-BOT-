# 🤖 Trading Bot Agent

AI-powered trading agent with **book-based knowledge**, **multi-timeframe analysis**, **real-time TradingView data**, and **persistent memory**.

## 📚 Knowledge Sources

| Book | Focus | Key Concepts |
|------|-------|--------------|
| **Trading in the Zone** (Mark Douglas) | Psychology | 5 Fundamental Truths, 7 Principles of Consistency, Kill Switches |
| **Forex Price Action Scalping** (Bob Volman) | Execution | 7 Scalp Setups (DD, FB, SB, BB, RB, IRB, ARB), Pattern Detection |
| **Art & Science of Technical Analysis** (Adam Grimes) | Structure | S/R Framework, Trend Phases, Statistical Edge, Indicator Usage |
| **Forex Factory Calendar** | News | High-impact event rules, session timing, news trading strategy |

## 🧠 Multi-Timeframe Framework

```
Daily (1D)  → Overall trend direction (the "wind at your back")
H4 (240m)   → Key support & resistance levels
H1 (60m)    → Entry setup identification
M15 (15m)   → Signal confirmation
M5/M1       → Scalping execution precision
```

## 🚀 Usage

### Terminal Mode (Web UI with live chart)
```bash
npm start
# Opens at http://localhost:3000
```

### Agent Mode (CLI autonomous monitoring)
```bash
npm start -- --agent --symbol=BINANCE:BTCUSDT
```

### One-Shot Analysis
```bash
npm run analyze -- --symbol=BINANCE:BTCUSDT
```

## ⚡ Features

- **Real-time prices** from TradingView WebSocket
- **Interactive chart** (Lightweight Charts) in browser
- **Multi-timeframe analysis** with confluence scoring (0-10)
- **Signal generation** with Entry/SL/TP1/TP2/TP3
- **Trade grading** (A/B/C based on confluence)
- **Psychology monitoring** (kill switches from Trading in the Zone)
- **Persistent memory** (trade journal, lessons learned, performance metrics)
- **Risk management** (max 2% per trade, 6% daily, position sizing)

## 📊 Signal Confluence Factors

| Factor | Weight | Source |
|--------|--------|--------|
| Trend alignment (HTF) | 2 | Art & Science |
| S/R level | 2 | Art & Science |
| Candle pattern | 1 | Price Action Scalping |
| EMA support | 1 | Art & Science |
| Volume confirmation | 1 | All books |
| Momentum (RSI) | 1 | Art & Science |
| Multi-TF agreement | 2 | Combined framework |

**Minimum score to trade: 5/10**

## 🧠 Memory System

The agent remembers:
- All trade records (entry, exit, P&L, setup, notes)
- Market observations (patterns, behaviors, correlations)
- Lessons learned (categorized, with reinforcement counter)
- Performance metrics (win rate, expectancy, profit factor)
- Daily journal entries

## 🛡️ Risk Rules

- Max risk per trade: 2% of capital
- Max daily risk: 6% of capital
- Scalping: 1% risk, 1.5 RR target
- Swing: 2% risk, 3.0 RR target
- Kill switch: 3 consecutive losses → stop trading
- Kill switch: 3% daily loss → done for the day

## ⚠️ Disclaimer

This is an **educational tool** for technical analysis. It is NOT financial advice.
Trading cryptocurrencies and forex carries significant risk. You can lose more than
your investment. Past performance does not guarantee future results.
Always trade with money you can afford to lose and seek professional financial advice.
