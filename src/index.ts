/**
 * Trading Bot Agent - Main Entry Point
 * 
 * Modes:
 *   - "terminal" : Start the web-based trading terminal (default)
 *   - "agent"    : Start the autonomous agent in CLI mode
 *   - "analyze"  : Run a one-shot analysis and exit
 * 
 * Usage:
 *   npm start                  → Start terminal server
 *   npm run start -- --agent   → Start CLI agent
 *   npm run analyze            → One-shot analysis
 */

import { TradingBotAgent } from './agent/orchestrator.js';

const args = process.argv.slice(2);
const mode = args.includes('--agent') ? 'agent' : args.includes('--analyze') ? 'analyze' : 'terminal';

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  🤖 TRADING BOT AGENT v1.0                   ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  📚 Knowledge Base:                                          ║
║     • Trading in the Zone (Mark Douglas)                     ║
║     • Forex Price Action Scalping (Bob Volman)               ║
║     • The Art & Science of Technical Analysis (Adam Grimes)  ║
║     • Forex Factory Calendar Logic                           ║
║                                                              ║
║  🧠 Multi-Timeframe Framework:                               ║
║     Daily  → Trend Direction                                 ║
║     H4     → Key Support & Resistance                        ║
║     H1     → Entry Setup                                     ║
║     M15    → Confirmation                                    ║
║     M5/M1  → Scalping Execution                              ║
║                                                              ║
║  📡 Data: TradingView Real-Time WebSocket                    ║
║  💾 Memory: Persistent trade journal & lessons               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

  if (mode === 'terminal') {
    console.log('🖥️  Starting Trading Terminal...\n');
    // Dynamic import to avoid loading express when not needed
    await import('./terminal/server.js');
    
  } else if (mode === 'agent') {
    console.log('🤖 Starting Autonomous Agent Mode...\n');
    const symbol = args.find(a => a.startsWith('--symbol='))?.split('=')[1] || 'BINANCE:BTCUSDT';
    const agent = new TradingBotAgent(symbol);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nReceived SIGINT...');
      await agent.stop();
      process.exit(0);
    });
    
    await agent.start();
    
  } else if (mode === 'analyze') {
    console.log('🔍 Running One-Shot Analysis...\n');
    const symbol = args.find(a => a.startsWith('--symbol='))?.split('=')[1] || 'BINANCE:BTCUSDT';
    const agent = new TradingBotAgent(symbol);
    
    try {
      // Just connect and run one analysis
      const { connectToTradingView, getMultiTimeframeData } = await import('./data/tradingview-connector.js');
      const { performMultiTimeframeAnalysis } = await import('./analysis/multi-timeframe.js');
      
      console.log(`Connecting to TradingView for ${symbol}...`);
      const connection = await connectToTradingView();
      
      console.log('Fetching multi-timeframe data...');
      const data = await getMultiTimeframeData(connection, symbol, 200);
      
      console.log('Running analysis...\n');
      const result = performMultiTimeframeAnalysis(data, symbol);
      
      // Print results
      console.log('═══════════════════════════════════════');
      console.log(`Symbol: ${result.symbol}`);
      console.log(`Overall Bias: ${result.overallBias}`);
      console.log(`Confluence: ${result.confluenceScore}/10`);
      console.log('───────────────────────────────────────');
      result.reasoning.forEach(r => console.log(r));
      console.log('═══════════════════════════════════════');
      
      if (result.signal) {
        console.log('\n🎯 TRADE SIGNAL:');
        console.log(`  Direction: ${result.signal.direction.toUpperCase()}`);
        console.log(`  Entry: ${result.signal.entry}`);
        console.log(`  Stop Loss: ${result.signal.stopLoss}`);
        console.log(`  TP1: ${result.signal.takeProfit1}`);
        console.log(`  TP2: ${result.signal.takeProfit2}`);
        console.log(`  TP3: ${result.signal.takeProfit3}`);
        console.log(`  R:R: 1:${result.signal.riskRewardRatio.toFixed(1)}`);
        console.log(`  Grade: ${result.signal.grade}`);
      } else {
        console.log('\n⏸️  No trade signal - insufficient confluence');
      }
      
      await connection.close();
      process.exit(0);
    } catch (err) {
      console.error('Analysis failed:', err);
      process.exit(1);
    }
  }
}

main().catch(console.error);
