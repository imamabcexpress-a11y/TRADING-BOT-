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

// Fallback model chain - tries each until one works
const MODEL_CHAIN = [
  process.env.AI_MODEL || 'gemini-3.5-flash',
  'gpt-4o-mini',
  'gemini-3.5-flash',
  'qwen3.6-plus',
  'kimi-k2.5',
];

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

// Build compact system prompt (optimized for API token limits)
function buildSystemPrompt(): string {
  return `You are a professional trading analyst. Analyze using multi-timeframe confluence and price action.

RULES:
- Only trade with 5+/10 confluence (trend+S/R+pattern+EMA+momentum)
- Min R:R 1.5:1. Use ATR*1.5 for SL distance.
- Setups: pullback in trend, breakout retest, failed breakout, inside bar break, range break
- If unsure = WAIT. No trade > bad trade.
- Daily=trend, H4=S/R, H1=setup, M15=confirm

Respond ONLY in valid JSON. No markdown.`;
}

// Build compact user prompt with key data only
function buildAnalysisPrompt(
  symbol: string,
  mtfResult: MultiTimeframeResult,
  recentCandles: Candle[],
  currentPrice: number
): string {
  const analyses = mtfResult.analyses;
  
  // Compact timeframe summaries
  const tfLines: string[] = [];
  for (const [tf, a] of Object.entries(analyses)) {
    const srTop = a.srLevels.slice(0, 2).map(s => `${s.type[0]}:${s.level.toFixed(0)}`).join(',');
    tfLines.push(`${tf}: trend=${a.trend.direction}(${a.trend.strength}) bias=${a.bias} RSI=${a.rsi.toFixed(0)} EMA20=${a.ema20.toFixed(0)} EMA50=${a.ema50.toFixed(0)} ATR=${a.atr.toFixed(0)} patterns=[${a.patterns.join(',')}] SR=[${srTop}]`);
  }

  // Last 5 candles compact
  const last5 = recentCandles.slice(-5).map(c => 
    `${c.close>c.open?'▲':'▼'}O${c.open.toFixed(0)}H${c.high.toFixed(0)}L${c.low.toFixed(0)}C${c.close.toFixed(0)}`
  ).join(' ');

  return `${symbol} @ ${currentPrice.toFixed(2)} | Bias: ${mtfResult.overallBias} | Confluence: ${mtfResult.confluenceScore}/10

${tfLines.join('\n')}

Last 5 H1 candles: ${last5}

Decide: BUY, SELL, or WAIT. Respond ONLY JSON:
{"action":"BUY/SELL/WAIT","confidence":<0-100>,"entry":<price>,"stopLoss":<price>,"takeProfit1":<price>,"takeProfit2":<price>,"takeProfit3":<price>,"riskRewardRatio":<num>,"reasoning":"<2-3 sentences WHY, reference setup name>","technicalFactors":["<factor>"],"riskWarnings":["<warning>"],"marketContext":"<phase>","setup":"<name>","grade":"A/B/C","timeframe":"<tf>","invalidation":"<what breaks it>"}`;
}

// Call the AI API with fallback model chain
async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!API_KEY) {
    throw new Error('AI_API_KEY not configured in .env');
  }

  // Try each model in the chain until one succeeds
  const uniqueModels = [...new Set(MODEL_CHAIN)];
  
  for (const model of uniqueModels) {
    try {
      console.log(`  Trying model: ${model}...`);
      const response = await axios.post(
        `${API_BASE}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 2000,
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const content = response.data.choices?.[0]?.message?.content || '';
      if (!content) continue; // Try next model if empty
      
      console.log(`  ✅ Success with model: ${model}`);
      return content;
    } catch (err: any) {
      const status = err.response?.status || 'timeout';
      console.log(`  ❌ ${model} failed (${status}), trying next...`);
      continue; // Try next model
    }
  }

  throw new Error(`All AI models failed: ${uniqueModels.join(', ')}`);
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
