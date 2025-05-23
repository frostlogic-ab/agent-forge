import { Agent, RAGWithChroma } from "../index";
import { OpenAIEmbeddingProvider } from "../rag/openai-embedding-provider";
import { GeminiEmbeddingProvider } from "../rag/gemini-embedding-provider";
import dotenv from "dotenv";

dotenv.config();

// Choose embedding provider based on environment variable
const embeddingProvider = process.env.EMBEDDING_PROVIDER === "gemini"
  ? new GeminiEmbeddingProvider(process.env.GEMINI_API_KEY!)
  : new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY!);

@RAGWithChroma(
  process.env.CHROMA_URL || "http://localhost:8000",
  [
    { id: "1", text: "Agent Forge is a TypeScript framework for AI agents." },
    { id: "2", text: "ChromaDB is a local vector database for document retrieval." },
  ],
  { embeddingProvider }
)
class RAGAgent extends Agent {
  constructor() {
    super({
      name: "RAGAgent",
      role: "Knowledge Assistant",
      description: "Answers questions using a local document index.",
      objective: "Provide accurate answers using retrieved documents.",
      model: process.env.OPENAI_MODEL || "gpt-4",
      temperature: 0.7,
    });
  }
}

async function main() {
  // Create the agent instance
  const agent = new RAGAgent();

  // Add more documents in real time
  await (agent as any).addDocuments([
    { id: "3", text: "You can add documents in real time!" },
    { id: "4", text: "RAG stands for Retrieval-Augmented Generation." },
  ]);

  // Run a query
  const result = await agent.run("What is Agent Forge and what does RAG mean?");
  console.log("\nAgent Output:\n", result.output);
}

main().catch(console.error); 