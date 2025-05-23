import { Agent } from "../core/agent";
import { Tool } from "../tools/tool";
import type { ToolParameter } from "../types";
import { ChromaIndexer } from "./chroma-indexer";

// EmbeddingProvider interface
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
}

interface RAGWithChromaOptions {
  embeddingProvider?: EmbeddingProvider;
  collection?: string;
}

// RAGTool extends Tool for agent compatibility
class RAGTool extends Tool {
  private indexer: ChromaIndexer;
  constructor(indexer: ChromaIndexer) {
    const parameters: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description: "The query to retrieve relevant documents for.",
        required: true,
      },
    ];
    super(
      "retrieval",
      "Retrieves relevant documents from the knowledge base.",
      parameters,
      "array"
    );
    this.indexer = indexer;
  }
  protected async run(params: { query: string }) {
    return await this.indexer.search(params.query);
  }
}

// Decorator supporting both function and class usage
export function RAGWithChroma(
  chromaUrl: string,
  docs: Array<{ id: string; text: string }>,
  options?: RAGWithChromaOptions
): any {
  function getProvider(): EmbeddingProvider {
    if (!options?.embeddingProvider) {
      throw new Error(
        "RAGWithChroma requires an embeddingProvider (e.g., OpenAIEmbeddingProvider or GeminiEmbeddingProvider)."
      );
    }
    return options.embeddingProvider;
  }
  return (target: any) => {
    if (typeof target === "function" && target.prototype instanceof Agent) {
      return class extends target {
        private static _ragIndexer = new ChromaIndexer(
          chromaUrl,
          getProvider(),
          options?.collection || "default"
        );
        constructor(...args: any[]) {
          super(...args);
          if (!(this.constructor as any)._ragDocsInitialized) {
            (this.constructor as any)._ragIndexer.addDocuments(docs);
            (this.constructor as any)._ragDocsInitialized = true;
          }
          (this as any).addDocuments = async (
            newDocs: Array<{ id: string; text: string }>
          ) => {
            await (this.constructor as any)._ragIndexer.addDocuments(newDocs);
          };
          if (typeof this.addTool === "function") {
            this.addTool(new RAGTool((this.constructor as any)._ragIndexer));
          }
        }
      };
    }
    // Function-style usage
    return (agent: Agent) => {
      const indexer = new ChromaIndexer(
        chromaUrl,
        getProvider(),
        options?.collection || "default"
      );
      indexer.addDocuments(docs);
      (agent as any).addDocuments = async (
        newDocs: Array<{ id: string; text: string }>
      ) => {
        await indexer.addDocuments(newDocs);
      };
      if (typeof agent.addTool === "function") {
        agent.addTool(new RAGTool(indexer));
      }
      return agent;
    };
  };
}
