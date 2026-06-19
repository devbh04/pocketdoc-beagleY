import { startQVACProvider } from '@qvac/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Optional seed for deterministic identity/public key
const seed = process.env.PROVIDER_SEED || process.argv[2];
if (seed) {
  process.env["QVAC_HYPERSWARM_SEED"] = seed;
  console.log(`🔑 Using seed for deterministic provider identity.`);
} else {
  console.log(`🎲 No provider seed specified. Generating random identity...`);
}

async function start() {
  console.log(`🚀 Starting PocketDoc QVAC P2P Provider...`);
  try {
    const response = await startQVACProvider();
    
    console.log('====================================================');
    console.log('✅ Provider service started successfully!');
    console.log('🔗 Ready for delegated inference requests.');
    console.log(`🆔 Provider Public Key: ${response.publicKey}`);
    console.log('====================================================');

    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping provider service...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Stopping provider service...');
      process.exit(0);
    });

    // Keep process alive
    process.stdin.resume();
  } catch (err) {
    console.error('❌ Provider startup failed:', err);
    process.exit(1);
  }
}

start();
