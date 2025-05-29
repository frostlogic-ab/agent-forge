export interface RAGChromaDbConfig {
  collectionName: string;
  chromaUrl?: string;
  embeddingModel?: string;
  topK?: number;
  similarityThreshold?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  maxRetries?: number;
  timeout?: number;
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
    originalLength: number;
    [key: string]: any;
  };
  embedding?: number[];
}

export interface RAGSearchResult {
  content: string;
  metadata: {
    source: string;
    score: number;
    chunkIndex: number;
    [key: string]: any;
  };
}

export interface RAGQueryOptions {
  topK?: number;
  similarityThreshold?: number;
  includeMetadata?: boolean;
}

export interface DocumentIndexingResult {
  documentsProcessed: number;
  chunksCreated: number;
  errors: string[];
  successfulSources: string[];
  failedSources: string[];
}

export interface ChromaDbClientConfig {
  url: string;
  maxRetries: number;
  timeout: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
