import { Agent } from "../core/agent";
import { RAGTool } from "./rag-tool";
import type { RAGChromaDbConfig } from "./types";

/**
 * RAG ChromaDB decorator that adds document retrieval capabilities to an agent.
 * Automatically adds a RAG tool that can search through indexed documents.
 *
 * Usage:
 *   @RAGChromaDb({
 *     collectionName: "my_documents",
 *     chromaUrl: "http://localhost:8000",
 *     topK: 5,
 *     similarityThreshold: 0.7
 *   })
 *   @agent(config)
 *   class MyAgent extends Agent {}
 *
 * @param config RAG configuration options
 */
export function RAGChromaDb(config: RAGChromaDbConfig): ClassDecorator {
  return (target: any): any => {
    // Runtime check: ensure target is an Agent constructor
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@RAGChromaDb decorator can only be applied to classes extending Agent"
      );
    }

    // Return a class that extends the target and adds RAG functionality
    return class extends target {
      private __ragTool?: RAGTool;
      private __ragConfig: RAGChromaDbConfig;
      private __ragInitialized = false;

      constructor(...args: any[]) {
        super(...args);

        this.__ragConfig = {
          chromaUrl: "http://localhost:8000",
          topK: 5,
          similarityThreshold: 0.0,
          chunkSize: 1000,
          chunkOverlap: 200,
          maxRetries: 3,
          timeout: 30000,
          ...config,
        };
      }

      private async initializeRAG(): Promise<void> {
        if (this.__ragInitialized) {
          return;
        }

        try {
          // Create RAG tool
          this.__ragTool = new RAGTool(this.__ragConfig);

          // Initialize the tool
          await this.__ragTool.initialize();

          // Add the tool to the agent
          if (typeof this.addTool === "function") {
            this.addTool(this.__ragTool);
          }

          this.__ragInitialized = true;
        } catch (error) {
          // Log warning but don't fail
          console.warn(
            `[RAGChromaDb] Failed to initialize RAG tool for agent: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          console.warn(
            `[RAGChromaDb] Ensure ChromaDB is running at ${this.__ragConfig.chromaUrl}`
          );
        }
      }

      // Override run method to auto-initialize RAG before first use
      async run(input: string, options?: any): Promise<any> {
        // Initialize RAG if not already done
        if (!this.__ragInitialized) {
          await this.initializeRAG();
        }

        // Call the parent run method
        return super.run(input, options);
      }

      /**
       * Manually initialize RAG if auto-initialization failed
       */
      async initializeRAGManually(): Promise<void> {
        this.__ragInitialized = false;
        await this.initializeRAG();
      }

      /**
       * Get the RAG tool instance
       */
      getRAGTool(): RAGTool | undefined {
        return this.__ragTool;
      }

      /**
       * Get RAG configuration
       */
      getRAGConfig(): RAGChromaDbConfig {
        return { ...this.__ragConfig };
      }

      /**
       * Check if RAG is initialized
       */
      isRAGInitialized(): boolean {
        return this.__ragInitialized;
      }

      /**
       * Get collection information
       */
      async getRAGCollectionInfo(): Promise<any> {
        if (!this.__ragTool) {
          throw new Error("RAG tool not initialized");
        }
        return await this.__ragTool.getCollectionInfo();
      }

      /**
       * Close RAG resources
       */
      async closeRAG(): Promise<void> {
        if (this.__ragTool) {
          await this.__ragTool.close();
          this.__ragInitialized = false;
        }
      }
    };
  };
}
