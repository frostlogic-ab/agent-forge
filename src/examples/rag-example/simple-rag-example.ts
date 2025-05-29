import * as dotenv from "dotenv";
import {
  Agent,
  agent,
  llmProvider,
  forge,
  readyForge,
  LLMProvider,
  RAGChromaDb,
  AgentForge,
} from "../../index";

// Load environment variables
dotenv.config();

// Simple RAG-enabled agent
@RAGChromaDb({
  collectionName: "company_knowledge_base",
  chromaUrl: "http://localhost:8000",
  topK: 3,
  similarityThreshold: 0.1,
})
@agent({
  name: "Knowledge Assistant",
  role: "Knowledge Base Specialist",
  description: "Assistant with access to company knowledge base",
  objective: "Provide accurate information from company documents",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.3,
})
class KnowledgeAssistant extends Agent {}

@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {
  apiKey: process.env.LLM_API_KEY,
})
@forge()
class SimpleRAGExample {
  static forge: AgentForge;

  static async run() {
    try {
      // Create and register agent
      const agent = new KnowledgeAssistant();
      await readyForge(SimpleRAGExample, [agent]);

      // Ask a question - RAG will auto-initialize on first use
      const result = await agent.run(
        "What is our company's remote work policy? Include eligibility requirements."
      );
      
      console.log(result.output);
      
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
    }
  }
}

// Main execution
if (require.main === module) {
  SimpleRAGExample.run();
}

export { SimpleRAGExample }; 