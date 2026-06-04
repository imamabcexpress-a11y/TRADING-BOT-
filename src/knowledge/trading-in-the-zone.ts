/**
 * TRADING IN THE ZONE - Mark Douglas
 * Core Psychology & Probabilistic Mindset Framework
 * 
 * Key Concepts: Think in probabilities, consistency, belief systems,
 * the 5 fundamental truths, 7 principles of consistency
 */

export interface PsychologyState {
  emotionalState: 'neutral' | 'fear' | 'greed' | 'revenge' | 'euphoria';
  consecutiveWins: number;
  consecutiveLosses: number;
  dailyPnL: number;
  isInZone: boolean;
}

export const FIVE_FUNDAMENTAL_TRUTHS = [
  "Anything can happen in the market",
  "You don't need to know what's going to happen next to make money",
  "There is a random distribution between wins and losses for any given set of variables that define an edge",
  "An edge is nothing more than an indication of a higher probability of one thing happening over another",
  "Every moment in the market is unique"
] as const;

export const SEVEN_PRINCIPLES_OF_CONSISTENCY = [
  "I objectively identify my edges",
  "I predefine the risk of every trade",
  "I completely accept the risk or I am willing to let go of the trade",
  "I act on my edges without reservation or hesitation",
  "I pay myself as the market makes money available to me",
  "I continually monitor my susceptibility for making errors",
  "I understand the absolute necessity of these principles of consistent success and never violate them"
] as const;

export const ZONE_RULES = {
  // Before entering any trade
  preTradeChecklist: [
    "Is this a valid setup from my edge definition?",
    "Have I predefined my risk (stop loss)?",
    "Am I accepting this risk completely?",
    "Am I free from emotional bias (fear/greed/revenge)?",
    "Is this within my daily risk limit?",
    "Am I treating this as just ONE trade in a series of probabilities?"
  ],

  // During trade management
  duringTrade: [
    "Let the market do what it does - don't predict",
    "Follow the plan - don't move stops wider",
    "Take profits at predefined levels",
    "Accept that this trade might be a loser - that's normal",
    "Monitor for emotional interference"
  ],

  // After trade
  postTrade: [
    "Did I follow my rules?",
    "Was the outcome irrelevant to rule-following?",
    "Log the trade regardless of outcome",
    "No revenge trading after a loss",
    "No overconfidence after a win"
  ],

  // Kill switches - when to STOP trading
  killSwitches: {
    maxConsecutiveLosses: 3,
    maxDailyLossPercent: 3,
    emotionalStates: ['revenge', 'euphoria', 'fear'] as const,
    requiredCooldownMinutes: 30
  }
};

export function assessPsychologyState(state: PsychologyState): {
  canTrade: boolean;
  reason: string;
  recommendation: string;
} {
  // Kill switch: too many consecutive losses
  if (state.consecutiveLosses >= ZONE_RULES.killSwitches.maxConsecutiveLosses) {
    return {
      canTrade: false,
      reason: `${state.consecutiveLosses} consecutive losses - psychological reset needed`,
      recommendation: "Step away. Review trades objectively. Return only when emotionally neutral."
    };
  }

  // Kill switch: emotional state
  if (['revenge', 'euphoria', 'fear'].includes(state.emotionalState)) {
    return {
      canTrade: false,
      reason: `Emotional state: ${state.emotionalState} - not in the zone`,
      recommendation: "Acknowledge the emotion. Wait 30 minutes. Re-assess before trading."
    };
  }

  // Kill switch: daily loss limit
  if (state.dailyPnL <= -ZONE_RULES.killSwitches.maxDailyLossPercent) {
    return {
      canTrade: false,
      reason: `Daily loss limit hit: ${state.dailyPnL}%`,
      recommendation: "Done for today. Accept the loss. Tomorrow is a new day of probabilities."
    };
  }

  // Caution: winning streak (overconfidence risk)
  if (state.consecutiveWins >= 5) {
    return {
      canTrade: true,
      reason: "Winning streak - proceed with extra caution",
      recommendation: "Reduce position size. Winning streaks create overconfidence. Stay humble."
    };
  }

  return {
    canTrade: true,
    reason: "Psychology state is clear - in the zone",
    recommendation: "Trade your edge. Accept the outcome. Think in probabilities."
  };
}

export const BELIEF_SYSTEM = {
  marketBeliefs: [
    "The market is a stream of opportunities",
    "Each trade is independent of the last",
    "My edge works over a series of trades, not on any single trade",
    "Losses are a cost of doing business",
    "I cannot control the market, only my actions"
  ],
  
  selfBeliefs: [
    "I am a consistent trader",
    "I follow my rules without exception", 
    "I accept risk freely on every trade",
    "I don't need to be right to make money",
    "I am responsible for my results"
  ]
};
