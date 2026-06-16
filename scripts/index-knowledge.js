import { loadModel, ragIngest, EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🔄 Loading Gemma Embedding model...');
  let embeddingModelId;
  try {
    embeddingModelId = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0 });
    console.log(`✅ Embedding model loaded successfully: ${embeddingModelId}`);
  } catch (err) {
    console.error('❌ Failed to load embedding model:', err);
    process.exit(1);
  }

  // Look for knowledge/ directory relative to project root
  const knowledgeDir = path.join(__dirname, '..', 'knowledge');
  const files = ['first-aid.md', 'symptoms.md', 'medications.md', 'emergency.md'];
  
  const documents = [];
  for (const file of files) {
    const filePath = path.join(knowledgeDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`📖 Reading knowledge source: ${file}`);
      const content = fs.readFileSync(filePath, 'utf8');
      documents.push(content);
    } else {
      console.warn(`⚠️ Warning: knowledge file ${file} not found at ${filePath}`);
    }
  }

  if (documents.length === 0) {
    console.error('❌ Error: No documents found to index.');
    process.exit(1);
  }

  console.log('\n📥 Ingesting documents into vector database workspace "pocketdoc"...');
  try {
    const result = await ragIngest({
      modelId: embeddingModelId,
      documents,
      workspace: 'pocketdoc',
      chunk: true,
      chunkOpts: {
        chunkSize: 500,
        chunkOverlap: 100,
        chunkStrategy: 'paragraph'
      },
      onProgress: (stage, current, total) => {
        console.log(`   [RAG Ingest] Stage: ${stage} | Progress: ${current}/${total}`);
      }
    });

    console.log('\n====================================================');
    console.log('✅ RAG Ingest completed successfully!');
    console.log(`📊 Chunks Indexed: ${result.processed.length}`);
    console.log(`🗑️ Dropped Indices: ${result.droppedIndices.length}`);
    console.log('====================================================');
  } catch (err) {
    console.error('❌ RAG Ingest failed:', err);
    process.exit(1);
  }
}

main().catch(console.error);
