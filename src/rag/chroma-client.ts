import { type ChromaClient, type Collection, IncludeEnum } from "chromadb";
import type {
  ChromaDbClientConfig,
  DocumentChunk,
  RAGQueryOptions,
  RAGSearchResult,
} from "./types";

/**
 * Wrapper for ChromaDB client with built-in error handling and retry logic
 */
export class ChromaDbClient {
  private client: ChromaClient | null = null;
  private collections: Map<string, Collection> = new Map();
  private config: ChromaDbClientConfig;
  private isConnected = false;

  constructor(config: ChromaDbClientConfig) {
    this.config = config;
  }

  /**
   * Initialize the ChromaDB client connection
   */
  async initialize(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        // Import ChromaClient to handle potential module loading issues
        const { ChromaClient } = await import("chromadb");
        this.client = new ChromaClient({
          path: this.config.url,
        });

        // Test the connection
        await this.client.heartbeat();
        this.isConnected = true;
        return;
      } catch (error) {
        retries++;
        if (retries >= this.config.maxRetries) {
          throw new Error(
            `Failed to connect to ChromaDB after ${this.config.maxRetries} attempts: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      }
    }
  }

  /**
   * Ensure the client is connected
   */
  private ensureConnected(): void {
    if (!this.isConnected || !this.client) {
      throw new Error(
        "ChromaDB client not connected. Call initialize() first."
      );
    }
  }

  /**
   * Get or create a collection
   */
  async getOrCreateCollection(
    name: string,
    embeddingFunction?: any
  ): Promise<Collection> {
    this.ensureConnected();

    if (this.collections.has(name)) {
      const cachedCollection = this.collections.get(name);
      if (cachedCollection) {
        return cachedCollection;
      }
    }

    if (!this.client) {
      throw new Error("ChromaDB client not initialized");
    }

    try {
      // Try to get existing collection first
      const collection = await this.client.getCollection({
        name,
        embeddingFunction,
      });
      this.collections.set(name, collection);
      return collection;
    } catch (_error) {
      // Collection doesn't exist, create it
      try {
        const collection = await this.client.createCollection({
          name,
          embeddingFunction,
        });
        this.collections.set(name, collection);
        return collection;
      } catch (createError) {
        throw new Error(
          `Failed to get or create collection '${name}': ${
            createError instanceof Error
              ? createError.message
              : String(createError)
          }`
        );
      }
    }
  }

  /**
   * Add documents to a collection
   */
  async addDocuments(
    collectionName: string,
    chunks: DocumentChunk[]
  ): Promise<void> {
    const collection = await this.getOrCreateCollection(collectionName);

    if (chunks.length === 0) {
      return;
    }

    // Validate chunks before processing
    const validChunks = chunks.filter((chunk) => {
      if (!chunk.id || !chunk.content || typeof chunk.content !== "string") {
        console.warn(
          `⚠️  Skipping invalid chunk: ${JSON.stringify(chunk).substring(0, 100)}...`
        );
        return false;
      }
      return true;
    });

    if (validChunks.length === 0) {
      console.warn(
        `⚠️  No valid chunks to add to collection '${collectionName}'`
      );
      return;
    }

    try {
      // Only include embeddings if ALL chunks have embeddings to ensure consistency
      const allHaveEmbeddings = validChunks.every(
        (chunk) => chunk.embedding && chunk.embedding.length > 0
      );

      await collection.add({
        ids: validChunks.map((chunk) => chunk.id),
        documents: validChunks.map((chunk) => chunk.content),
        metadatas: validChunks.map((chunk) => chunk.metadata),
        embeddings: allHaveEmbeddings
          ? validChunks.map((chunk) => chunk.embedding as number[])
          : undefined,
      });
    } catch (error) {
      throw new Error(
        `Failed to add documents to collection '${collectionName}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    collectionName: string,
    queryText: string,
    options: RAGQueryOptions = {}
  ): Promise<RAGSearchResult[]> {
    const collection = await this.getOrCreateCollection(collectionName);

    const {
      topK = 5,
      similarityThreshold = 0.0,
      includeMetadata = true,
    } = options;

    try {
      const includeFields: IncludeEnum[] = includeMetadata
        ? [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances]
        : [IncludeEnum.Documents, IncludeEnum.Distances];

      const results = await collection.query({
        queryTexts: [queryText],
        nResults: topK,
        include: includeFields,
      });

      if (
        !results.documents ||
        !results.documents[0] ||
        !results.distances ||
        !results.distances[0]
      ) {
        return [];
      }

      const searchResults: RAGSearchResult[] = [];

      for (let i = 0; i < results.documents[0].length; i++) {
        const distance = results.distances[0][i];
        const similarity = 1 - distance; // Convert distance to similarity

        if (similarity >= similarityThreshold) {
          const metadata = results.metadatas?.[0]?.[i] || {};
          const resultMetadata = {
            source: (metadata as any).source || "unknown",
            score: similarity,
            chunkIndex: (metadata as any).chunkIndex || 0,
            ...metadata,
          };

          searchResults.push({
            content: results.documents[0][i] || "",
            metadata: resultMetadata,
          });
        }
      }

      return searchResults.sort((a, b) => b.metadata.score - a.metadata.score);
    } catch (error) {
      throw new Error(
        `Failed to search collection '${collectionName}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<void> {
    this.ensureConnected();

    if (!this.client) {
      throw new Error("ChromaDB client not initialized");
    }

    try {
      await this.client.deleteCollection({ name });
      this.collections.delete(name);
    } catch (error) {
      throw new Error(
        `Failed to delete collection '${name}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(name: string): Promise<any> {
    const collection = await this.getOrCreateCollection(name);

    try {
      const count = await collection.count();
      return {
        name,
        count,
      };
    } catch (error) {
      throw new Error(
        `Failed to get collection info for '${name}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    this.ensureConnected();

    if (!this.client) {
      throw new Error("ChromaDB client not initialized");
    }

    try {
      const collections = await this.client.listCollections();
      return collections.map((collection: any) => {
        if (typeof collection === "string") {
          return collection;
        }
        return collection.name || "unknown";
      });
    } catch (error) {
      throw new Error(
        `Failed to list collections: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    this.collections.clear();
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Check if the client is connected
   */
  isConnectedToChroma(): boolean {
    return this.isConnected;
  }
}
