import * as dotenv from "dotenv";
import path from "node:path";
import { DocumentIndexer } from "../../rag/document-indexer";

// Load environment variables
dotenv.config();

/**
 * Example script showing how to train/index documents into ChromaDB for RAG
 * Enhanced with memory management and batch processing
 */
async function trainDocuments() {
  try {
    const indexer = new DocumentIndexer({
      collectionName: "company_knowledge_base",
      chromaUrl: "http://localhost:8000",
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    await indexer.initialize();

    const documentsPath = path.join(__dirname, "sample-documents");
    const result = await indexer.indexDirectory(documentsPath, true);

    console.log(`Indexed ${result.documentsProcessed} documents`);
    console.log(`Created ${result.chunksCreated} chunks`);
    
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
    }

    await indexer.close();

  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
  }
}

async function clearCollection() {
  try {
    const indexer = new DocumentIndexer({
      collectionName: "company_knowledge_base",
      chromaUrl: "http://localhost:8000",
    });

    await indexer.initialize();
    await indexer.clearCollection();
    await indexer.close();

    console.log("Collection cleared");

  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
  }
}

// Main execution
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case "clear":
      clearCollection();
      break;
    default:
      trainDocuments();
      break;
  }
}

export { trainDocuments, clearCollection }; 