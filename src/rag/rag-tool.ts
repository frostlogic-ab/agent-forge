import { Tool } from "../tools/tool";
import type { ToolParameter } from "../types";
import { ChromaDbClient } from "./chroma-client";
import type {
  RAGChromaDbConfig,
  RAGQueryOptions,
  RAGSearchResult,
} from "./types";

export class RAGTool extends Tool {
  private chromaClient: ChromaDbClient;
  private config: RAGChromaDbConfig;

  constructor(config: RAGChromaDbConfig) {
    const parameters: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description: "The search query to find relevant documents",
        required: true,
      },
      {
        name: "topK",
        type: "number",
        description: "Maximum number of documents to retrieve (optional)",
        required: false,
        default: config.topK || 5,
      },
      {
        name: "similarityThreshold",
        type: "number",
        description: "Minimum similarity score for results (optional)",
        required: false,
        default: config.similarityThreshold || 0.0,
      },
    ];

    super(
      "DocumentRetrieval",
      "Search and retrieve relevant documents from the knowledge base using semantic similarity",
      parameters,
      "Array of relevant document chunks with content and metadata"
    );

    this.config = {
      chromaUrl: "http://localhost:8000",
      topK: 5,
      similarityThreshold: 0.0,
      chunkSize: 1000,
      chunkOverlap: 200,
      maxRetries: 3,
      timeout: 30000,
      ...config,
    };

    this.chromaClient = new ChromaDbClient({
      url: this.config.chromaUrl || "http://localhost:8000",
      maxRetries: this.config.maxRetries || 3,
      timeout: this.config.timeout || 30000,
    });
  }

  /**
   * Initialize the RAG tool by connecting to ChromaDB
   */
  async initialize(): Promise<void> {
    try {
      await this.chromaClient.initialize();
    } catch (error) {
      throw new Error(
        `Failed to initialize RAG tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  protected async run(params: {
    query: string;
    topK?: number;
    similarityThreshold?: number;
  }): Promise<any> {
    const { query, topK, similarityThreshold } = params;

    // Validate input
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return {
        error: "Query parameter is required and must be a non-empty string",
        results: [],
      };
    }

    try {
      // Ensure ChromaDB connection
      if (!this.chromaClient.isConnectedToChroma()) {
        await this.chromaClient.initialize();
      }

      const searchOptions: RAGQueryOptions = {
        topK: topK || this.config.topK,
        similarityThreshold:
          similarityThreshold || this.config.similarityThreshold,
        includeMetadata: true,
      };

      const results = await this.chromaClient.search(
        this.config.collectionName,
        query.trim(),
        searchOptions
      );

      if (results.length === 0) {
        return {
          message: "No relevant documents found for the given query",
          query: query.trim(),
          results: [],
          searchOptions,
        };
      }

      // Format results for LLM consumption
      const formattedResults = this.formatResultsForLLM(results);

      return {
        message: `Found ${results.length} relevant document(s)`,
        query: query.trim(),
        results: formattedResults,
        searchOptions,
        retrievedCount: results.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if it's a connection error
      if (
        errorMessage.includes("Failed to connect") ||
        errorMessage.includes("ChromaDB")
      ) {
        return {
          error: `Unable to connect to the knowledge base. Please ensure ChromaDB is running at ${this.config.chromaUrl}`,
          query: query.trim(),
          results: [],
          troubleshooting: "Check if ChromaDB server is running and accessible",
        };
      }

      return {
        error: `Search failed: ${errorMessage}`,
        query: query.trim(),
        results: [],
      };
    }
  }

  /**
   * Format search results for optimal LLM consumption
   */
  private formatResultsForLLM(results: RAGSearchResult[]): any[] {
    return results.map((result, index) => {
      const relevanceScore = Math.round(result.metadata.score * 100);

      return {
        rank: index + 1,
        content: result.content,
        source: result.metadata.source,
        relevanceScore: `${relevanceScore}%`,
        chunkIndex: result.metadata.chunkIndex,
        metadata: {
          ...result.metadata,
          // Remove score from metadata to avoid duplication
          score: undefined,
        },
      };
    });
  }

  /**
   * Get information about the current collection
   */
  async getCollectionInfo(): Promise<any> {
    try {
      if (!this.chromaClient.isConnectedToChroma()) {
        await this.chromaClient.initialize();
      }

      return await this.chromaClient.getCollectionInfo(
        this.config.collectionName
      );
    } catch (error) {
      throw new Error(
        `Failed to get collection info: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Close the ChromaDB connection
   */
  async close(): Promise<void> {
    await this.chromaClient.close();
  }

  /**
   * Get the RAG configuration
   */
  getRagConfig(): RAGChromaDbConfig {
    return { ...this.config };
  }
}
