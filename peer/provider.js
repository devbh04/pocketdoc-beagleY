import { startQVACProvider, loadModel } from '@qvac/sdk';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🚀 Starting PocketDoc P2P Provider on Laptop...');
  
  // Configure seed for deterministic provider identity if present in environment
  const seed = process.env.QVAC_HYPERSWARM_SEED;
  if (seed) {
    process.env['QVAC_HYPERSWARM_SEED'] = seed;
    console.log(`🔑 Using configured QVAC_HYPERSWARM_SEED identity seed.`);
  }

  try {
    // Start QVAC Provider hosting local model resources over peer network
    const response = await startQVACProvider();
    if (!response.success) {
      throw new Error(`Failed to start provider: ${response.error}`);
    }

    console.log('====================================================');
    console.log('✅ QVAC P2P Provider service started successfully!');
    console.log(`🔑 Provider Public Key: ${response.publicKey}`);
    console.log('====================================================');
    console.log('Copy the key above to the BeagleY-AI server\'s .env file:');
    console.log(`PEER_PROVIDER_PUBLIC_KEY=${response.publicKey}`);
    console.log('====================================================');

    // Pre-load the MedPsy-4B-Q4_K_M model so it is cached and warm in memory
    const modelSrc = process.env.MEDPSY_4B_Q4 || 'https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/MedPsy-4B-Q4_K_M.gguf';
    console.log(`[Provider] Preloading MedPsy 4B model from: ${modelSrc}`);
    
    const modelId = await loadModel({
      modelSrc,
      modelType: 'llm',
      modelConfig: { ctx_size: 2048 }
    });
    
    console.log(`[Provider] Model MedPsy-4B loaded. Ready with ID: ${modelId}`);
    console.log('\n📡 Laptop is listening for delegated inference requests...');

    // Prevent process from exiting
    process.stdin.resume();
    process.on('SIGINT', () => {
      console.log('\n🛑 Laptop P2P Provider stopped.');
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Provider startup error:', err);
    process.exit(1);
  }
}

main();
