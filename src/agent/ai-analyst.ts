/**
 * AI Trading Analyst
 * Uses multi-model AI (via bluesminds API) to analyze markets
 * Combines technical data with book knowledge for decisions
 * 
 * The AI receives:
 * 1. Multi-timeframe technical data (indicators, S/R, patterns)
 * 2. Trading book rules (Trading in the Zone, Price Action, Art & Science)
 * 3. Current market context
 * 
 * The AI returns:
 * - Detailed reasoning (why trade / why not)
 * - Direction (long/short/flat)
 * - Entry/SL/TP levels
 * - Confidence score
 * - Risk warnings
 */

import axios from 'axios';
import { config } from 'dotenv';
import { MultiTimeframeResult, TradeSignal } from '../analysis/multi-timeframe.js';
import { Candle } from '../analysis/indicators.js';

config();

const API_BASE = process.env.AI_API_BASE_URL || 'https://api.bluesminds.com/v1';
const API_KEY = process.env.AI_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'gpt-4o';

export interface AIDecision {
  action: 'BUY' | 'SELL' | 'WAIT';
  confidence: number; // 0-100
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  reasoning: string; // Detailed explanation
  technicalFactors: string[];
  riskWarnings: string[];
  marketContext: string;
  setup: string;
  grade: 'A' | 'B' | 'C';
  timeframe: string;
  invalidation: string;
}

// Build the system prompt with all book knowledge
function buildSystemPrompt(): string {
  return `You are an elite trading analyst AI combining the wisdom of three master trading books:

## YOUR KNOWLEDGE BASE:

### 1. "Trading in the Zone" (Mark Douglas)
- Think in probabilities, not certainties
- Every trade outcome is independent
- 5 Fundamental Truths: anything can happen, you don't need to know what happens next to make money, random distribution of wins/losses, an edge is just higher probability, every moment is unique
- NEVER trade when emotionally compromised
- Kill switch: 3 consecutive losses = stop

### 2. "Forex Price Action Scalping" (Bob Volman)
- 7 Setups: DD (Double Doji Break), FB (First Break), SB (Second Break), BB (Block Break), RB (Range Break), IRB (Inside Range Break), ARB (Advanced Range Break)
- Read candle bodies and wicks for conviction
- Large body = strong conviction, small body = indecision
- Long wicks = rejection of price levels
- Wait for candle CLOSE for confirmation

### 3. "The Art & Science of Technical Analysis" (Adam Grimes)
- Market structure: HH+HL = uptrend, LL+LH = downtrend
- S/R zones (not lines): More touches = stronger, higher TF > lower TF
- Polarity principle: broken support becomes resistance
- EMA alignment: 20>50>200 = bullish, opposite = bearish
- Trend phases: Accumulation → Markup → Distribution → Markdown
- Patterns that work: pullback in trend (55-65% WR), breakout retest (50-60%), failed breakout (55-65%)
- ATR for stop loss: minimum 1.5x ATR distance

## MULTI-TIMEFRAME FRAMEWORK:
- Daily = Overall trend direction
- H4 = Key support & resistance
- H1 = Entry setup identification
- M15 = Confirmation
- M5/M1 = Scalping execution

## CONFLUENCE SCORING (minimum 5/10 to trade):
- Trend alignment with higher TF: +2
- At key S/R level: +2
- Candle pattern present: +1
- EMA support/resistance: +1
- Volume confirms: +1
- Momentum (RSI) aligned: +1
- Multi-TF agreement: +2

## STRICT RULES:
1. NEVER recommend a trade without at least 5/10 confluence
2. ALWAYS define exact entry, SL, TP1, TP2, TP3
3. Risk:Reward MUST be minimum 1:1.5
4. Explain WHY in detail - what setup, what confirmation
5. If unsure, say WAIT - no trade is better than a bad trade
6. Consider current market phase (impulse vs correction)
7. Check if price is at a decision point (S/R, EMA, pattern)

## RESPONSE FORMAT:
You MUST respond in valid JSON only. No markdown, no explanation outside JSON.`;
}

// Build the user prompt with actual market data
function buildAnalysisPrompt(
  symbol: string,
  mtfResult: MultiTimeframeResult,
  recentCandles: Candle[],
  currentPrice: number
): string {
  const analyses = mtfResult.analyses;
  
  // Summarize each timeframe
  const tfSummaries: string[] = [];
  for (const [tf, analysis] of Object.entries(analyses)) {
    tfSummaries.push(`
${tf}:
  - Trend: ${analysis.trend.direction} (${analysis.trend.strength}), Phase: ${analysis.trend.phase}
  - Bias: ${analysis.bias} (confidence: ${analysis.confidence}%)
  - EMA20: ${analysis.ema20.toFixed(2)}, EMA50: ${analysis.ema50.toFixed(2)}, EMA200: ${analysis.ema200.toFixed(2)}
  - RSI: ${analysis.rsi.toFixed(1)}
  - ATR: ${analysis.atr.toFixed(2)}
  - Patterns: ${analysis.patterns.length > 0 ? analysis.patterns.join(', ') : 'none'}
  - Structure: ${analysis.structure.trend}
  - S/R levels: ${analysis.srLevels.slice(0, 3).map(s => `${s.type}@${s.level.toFixed(2)}(str:${s.strength})`).join(', ') || 'none found'}`);
  }

  // Recent price action (last 10 candles)
  const last10 = recentCandles.slice(-10).map(c => 
    `[O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${c.volume.toFixed(0)}]`
  ).join('\n  ');

  return `Analyze ${symbol} for a trade decision.

CURRENT PRICE: ${currentPrice.toFixed(2)}
OVERALL BIAS FROM TECHNICALS: ${mtfResult.overallBias}
CONFLUENCE SCORE: ${mtfResult.confluenceScore}/10

MULTI-TIMEFRAME DATA:
${tfSummaries.join('\n')}

LAST 10 H1 CANDLES:
  ${last10}

Based on all your knowledge from the 3 books and the technical data above, provide your trading decision.

Respond ONLY with this JSON structure:
{
  "action": "BUY" or "SELL" or "WAIT",
  "confidence": <number 0-100>,
  "entry": <price>,
  "stopLoss": <price>,
  "takeProfit1": <price>,
  "takeProfit2": <price>,
  "takeProfit3": <price>,
  "riskRewardRatio": <number>,
  "reasoning": "<detailed 2-3 sentence explanation of WHY this trade, referencing specific book concepts>",
  "technicalFactors": ["<factor1>", "<factor2>", ...],
  "riskWarnings": ["<warning1>", ...],
  "marketContext": "<1 sentence market phase description>",
  "setup": "<setup name from Volman or Grimes>",
  "grade": "A" or "B" or "C",
  "timeframe": "<primary timeframe for this trade>",
  "invalidation": "<what invalidates this trade>"
}`;
}

// Call the AI API
async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Low temp for more consistent analysis
        max_tokens: 1500
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0]?.message?.content || '';
  } catch (err: any) {
    console.error('AI API Error:', err.response?.data || err.message);
    throw new Error(`AI API failed: ${err.response?.status || 'unknown'} - ${err.message}`);
  }
}

// Parse AI response to structured decision
function parseAIResponse(raw: string): AIDecision | null {
  try {
    // Clean up response - remove markdown code blocks if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    
    const parsed = JSON.parse(cleaned);
    
    // Validate required fields
    if (!parsed.action || !['BUY', 'SELL', 'WAIT'].includes(parsed.action)) {
      return null;
    }

    return {
      action: parsed.action,
      confidence: parsed.confidence || 0,
      entry: parsed.entry || 0,
      stopLoss: parsed.stopLoss || 0,
      takeProfit1: parsed.takeProfit1 || 0,
      takeProfit2: parsed.takeProfit2 || 0,
      takeProfit3: parsed.takeProfit3 || 0,
      riskRewardRatio: parsed.riskRewardRatio || 0,
      reasoning: parsed.reasoning || 'No reasoning provided',
      technicalFactors: parsed.technicalFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      marketContext: parsed.marketContext || '',
      setup: parsed.setup || 'unknown',
      grade: ['A', 'B', 'C'].includes(parsed.grade) ? parsed.grade : 'C',
      timeframe: parsed.timeframe || 'H1',
      invalidation: parsed.invalidation || ''
    };
  } catch (err) {
    console.error('Failed to parse AI response:', raw.substring(0, 200));
    return null;
  }
}

// Main analysis function
export async function analyzeWithAI(
  symbol: string,
  mtfResult: MultiTimeframeResult,
  recentCandles: Candle[],
  currentPrice: number
): Promise<AIDecision> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildAnalysisPrompt(symbol, mtfResult, recentCandles, currentPrice);

  console.log(`🤖 Requesting AI analysis for ${symbol}...`);

  const rawResponse = await callAI(systemPrompt, userPrompt);
  const decision = parseAIResponse(rawResponse);

  if (!decision) {
    // Fallback: WAIT decision
    return {
      action: 'WAIT',
      confidence: 0,
      entry: currentPrice,
      stopLoss: 0,
      takeProfit1: 0,
      takeProfit2: 0,
      takeProfit3: 0,
      riskRewardRatio: 0,
      reasoning: 'AI response could not be parsed. Staying flat for safety.',
      technicalFactors: [],
      riskWarnings: ['AI parsing failed - do not trade'],
      marketContext: 'Unknown',
      setup: 'none',
      grade: 'C',
      timeframe: 'H1',
      invalidation: 'N/A'
    };
  }

  console.log(`🤖 AI Decision: ${decision.action} (${decision.confidence}% confidence)`);
  return decision;
}

// Convert AI decision to TradeSignal (for paper trading engine)
export function aiDecisionToSignal(decision: AIDecision): TradeSignal | null {
  if (decision.action === 'WAIT') return null;
  if (decision.confidence < 60) return null; // Don't trade below 60% confidence
  if (decision.riskRewardRatio < 1.5) return null; // Minimum RR

  return {
    direction: decision.action === 'BUY' ? 'long' : 'short',
    entry: decision.entry,
    stopLoss: decision.stopLoss,
    takeProfit1: decision.takeProfit1,
    takeProfit2: decision.takeProfit2,
    takeProfit3: decision.takeProfit3,
    riskRewardRatio: decision.riskRewardRatio,
    grade: decision.grade,
    setup: decision.setup,
    confluenceFactors: decision.technicalFactors,
    invalidation: decision.invalidation
  };
}
