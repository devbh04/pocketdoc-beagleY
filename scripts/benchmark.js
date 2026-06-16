import dotenv from 'dotenv';
import * as qvac from '../server/qvac.js';

dotenv.config();

const BENCHMARK_QUERIES = [
  "How do I clean a shallow cut?",
  "What are the symptoms of a heat stroke?",
  "Can I take ibuprofen with aspirin?",
  "What is the first aid for minor kitchen burns?",
  "How to recognize an allergic reaction?",
  "What is the dosage for acetaminophen in adults?",
  "What should I do if someone is choking?",
  "What are common causes of a sudden high fever?",
  "How to treat a bee sting at home?",
  "When should I go to the ER for chest pain?"
];

async function main() {
  console.log('🔄 Initializing QVAC models for local benchmark run...');
  try {
    await qvac.init();
  } catch (err) {
    console.error('❌ Failed to initialize QVAC core:', err);
    process.exit(1);
  }

  console.log('\n🚀 Running 10-query offline benchmark...');
  console.log('=================================================================================');

  const results = [];

  for (let i = 0; i < BENCHMARK_QUERIES.length; i++) {
    const query = BENCHMARK_QUERIES[i];
    console.log(`[${i + 1}/10] Query: "${query}"`);
    
    const startTime = Date.now();
    let firstTokenTime = null;
    let tokenCount = 0;

    try {
      const run = await qvac.queryLocal(query);
      
      // Consume tokens as they arrive to measure TTFT and throughput
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          tokenCount++;
        }
      }

      // Wait for completion run finalization
      await run.final;

      const ttft = firstTokenTime ? (firstTokenTime - startTime) : 0;
      const duration = (Date.now() - startTime) / 1000;
      const tps = duration > 0 ? (tokenCount / duration) : 0;
      const ram = process.memoryUsage().rss / 1024 / 1024;

      results.push({
        'Query Preview': query.length > 40 ? query.substring(0, 37) + '...' : query,
        'TTFT (ms)': Math.round(ttft),
        'Tokens': tokenCount,
        'Speed (t/s)': parseFloat(tps.toFixed(2)),
        'RAM (MB)': Math.round(ram)
      });

    } catch (err) {
      console.error(`   ❌ Failed to execute query:`, err.message);
      results.push({
        'Query Preview': query.substring(0, 37) + '...',
        'TTFT (ms)': 'FAILED',
        'Tokens': 0,
        'Speed (t/s)': 0,
        'RAM (MB)': 0
      });
    }
  }

  console.log('\n📊 Benchmark Report (MedPsy-1.7B Local Inference)');
  console.log('=================================================================================');
  console.table(results);
  console.log('=================================================================================');
  console.log('Verification completed successfully.');
}

main().catch(console.error);
