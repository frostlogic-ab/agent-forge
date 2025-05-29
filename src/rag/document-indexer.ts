import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ChromaDbClient } from "./chroma-client";
import type {
  DocumentChunk,
  DocumentIndexingResult,
  RAGChromaDbConfig,
} from "./types";

export class DocumentIndexer {
  private chromaClient: ChromaDbClient;
  private config: RAGChromaDbConfig;
  private readonly BATCH_SIZE = 100; // Process documents in batches of 100 chunks
  private readonly MAX_FILE_SIZE_MB = 50; // Skip files larger than 50MB

  constructor(config: RAGChromaDbConfig) {
    this.config = {
      chromaUrl: "http://localhost:8000",
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
   * Initialize the document indexer
   */
  async initialize(): Promise<void> {
    await this.chromaClient.initialize();
  }

  /**
   * Index a single file with memory-efficient processing
   */
  async indexFile(filePath: string): Promise<DocumentIndexingResult> {
    const result: DocumentIndexingResult = {
      documentsProcessed: 0,
      chunksCreated: 0,
      errors: [],
      successfulSources: [],
      failedSources: [],
    };

    try {
      // Check file size before processing
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > this.MAX_FILE_SIZE_MB) {
        console.warn(
          `⚠️  Skipping large file: ${path.basename(filePath)} (${fileSizeMB.toFixed(1)}MB > ${this.MAX_FILE_SIZE_MB}MB)`
        );
        result.errors.push(
          `${filePath}: File too large (${fileSizeMB.toFixed(1)}MB)`
        );
        result.failedSources.push(filePath);
        return result;
      }

      const content = await this.loadFile(filePath);
      const chunks = this.chunkText(content, filePath);

      // Process chunks in batches to avoid memory issues
      await this.addChunksInBatches(chunks);

      result.documentsProcessed = 1;
      result.chunksCreated = chunks.length;
      result.successfulSources.push(filePath);

      // Force garbage collection hint
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      result.errors.push(`${filePath}: ${errorMessage}`);
      result.failedSources.push(filePath);
    }

    return result;
  }

  /**
   * Add chunks to ChromaDB in batches to prevent memory issues
   */
  private async addChunksInBatches(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i += this.BATCH_SIZE) {
      const batch = chunks.slice(i, i + this.BATCH_SIZE);
      await this.chromaClient.addDocuments(this.config.collectionName, batch);

      // Small delay to allow memory cleanup
      if (i + this.BATCH_SIZE < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Index multiple files from a directory with memory management
   */
  async indexDirectory(
    directoryPath: string,
    recursive = true
  ): Promise<DocumentIndexingResult> {
    const result: DocumentIndexingResult = {
      documentsProcessed: 0,
      chunksCreated: 0,
      errors: [],
      successfulSources: [],
      failedSources: [],
    };

    try {
      const files = await this.getFiles(directoryPath, recursive);
      console.log(`📁 Found ${files.length} files to process`);

      // Process files one by one to avoid memory buildup
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        console.log(`📊 Progress: ${i + 1}/${files.length}`);

        const fileResult = await this.indexFile(filePath);

        result.documentsProcessed += fileResult.documentsProcessed;
        result.chunksCreated += fileResult.chunksCreated;
        result.errors.push(...fileResult.errors);
        result.successfulSources.push(...fileResult.successfulSources);
        result.failedSources.push(...fileResult.failedSources);

        // Add a small delay between files to allow memory cleanup
        if (i < files.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      result.errors.push(`Directory processing error: ${errorMessage}`);
    }

    return result;
  }

  /**
   * Index multiple files from an array of file paths with memory management
   */
  async indexFiles(filePaths: string[]): Promise<DocumentIndexingResult> {
    const result: DocumentIndexingResult = {
      documentsProcessed: 0,
      chunksCreated: 0,
      errors: [],
      successfulSources: [],
      failedSources: [],
    };

    console.log(`📄 Processing ${filePaths.length} files`);

    // Process files one by one to avoid memory buildup
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      console.log(`📊 Progress: ${i + 1}/${filePaths.length}`);

      const fileResult = await this.indexFile(filePath);

      result.documentsProcessed += fileResult.documentsProcessed;
      result.chunksCreated += fileResult.chunksCreated;
      result.errors.push(...fileResult.errors);
      result.successfulSources.push(...fileResult.successfulSources);
      result.failedSources.push(...fileResult.failedSources);

      // Add a small delay between files to allow memory cleanup
      if (i < filePaths.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return result;
  }

  /**
   * Index text content directly with batch processing
   */
  async indexText(
    content: string,
    sourceName: string
  ): Promise<DocumentIndexingResult> {
    const result: DocumentIndexingResult = {
      documentsProcessed: 0,
      chunksCreated: 0,
      errors: [],
      successfulSources: [],
      failedSources: [],
    };

    try {
      const chunks = this.chunkText(content, sourceName);

      // Use batch processing for consistency
      await this.addChunksInBatches(chunks);

      result.documentsProcessed = 1;
      result.chunksCreated = chunks.length;
      result.successfulSources.push(sourceName);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      result.errors.push(`${sourceName}: ${errorMessage}`);
      result.failedSources.push(sourceName);
    }

    return result;
  }

  /**
   * Load and parse a file based on its extension
   */
  private async loadFile(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case ".txt":
      case ".md":
      case ".markdown":
        return await this.loadTextFile(filePath);
      case ".json":
        return await this.loadJsonFile(filePath);
      default:
        // For unsupported formats, try to read as text
        return await this.loadTextFile(filePath);
    }
  }

  /**
   * Load a text-based file
   */
  private async loadTextFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to read text file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load and extract text from a JSON file
   */
  private async loadJsonFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const jsonData = JSON.parse(content);

      // Extract text content from JSON recursively
      return this.extractTextFromJson(jsonData);
    } catch (error) {
      throw new Error(
        `Failed to read JSON file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Recursively extract text content from a JSON object (with safety checks)
   */
  private extractTextFromJson(
    obj: any,
    depth = 0,
    maxDepth = 10,
    visited = new WeakSet()
  ): string {
    // Prevent infinite recursion
    if (depth > maxDepth) {
      return "[max depth reached]";
    }

    // Prevent circular references
    if (obj && typeof obj === "object" && visited.has(obj)) {
      return "[circular reference]";
    }

    if (typeof obj === "string") {
      return obj;
    }

    if (Array.isArray(obj)) {
      if (obj && typeof obj === "object") visited.add(obj);
      return obj
        .slice(0, 1000) // Limit array size to prevent memory issues
        .map((item) =>
          this.extractTextFromJson(item, depth + 1, maxDepth, visited)
        )
        .join(" ");
    }

    if (typeof obj === "object" && obj !== null) {
      visited.add(obj);
      const values = Object.values(obj).slice(0, 100); // Limit object properties
      return values
        .map((value) =>
          this.extractTextFromJson(value, depth + 1, maxDepth, visited)
        )
        .join(" ");
    }

    return String(obj);
  }

  /**
   * Split text into chunks with overlap (with robust infinite loop protection)
   */
  private chunkText(text: string, source: string): DocumentChunk[] {
    const chunkSize = this.config.chunkSize || 1000;
    const chunkOverlap = Math.min(
      this.config.chunkOverlap || 200,
      Math.floor(chunkSize * 0.8)
    ); // Ensure overlap is max 80% of chunk size

    // Clean the text
    const cleanedText = text.replace(/\s+/g, " ").trim();

    if (cleanedText.length <= chunkSize) {
      return [
        {
          id: randomUUID(),
          content: cleanedText,
          metadata: {
            source,
            chunkIndex: 0,
            totalChunks: 1,
            originalLength: cleanedText.length,
          },
        },
      ];
    }

    const chunks: DocumentChunk[] = [];
    let startIndex = 0;
    let chunkIndex = 0;
    const maxChunks =
      Math.ceil(cleanedText.length / (chunkSize - chunkOverlap)) + 2; // More conservative safety limit

    while (startIndex < cleanedText.length && chunkIndex < maxChunks) {
      const endIndex = Math.min(startIndex + chunkSize, cleanedText.length);
      let chunkText = cleanedText.slice(startIndex, endIndex);

      // Try to break at word boundaries, but only if we have a reasonable chunk
      if (endIndex < cleanedText.length && chunkText.length > chunkSize * 0.8) {
        const lastSpaceIndex = chunkText.lastIndexOf(" ");
        if (lastSpaceIndex > chunkSize * 0.6) {
          // Only break if we retain at least 60% of chunk
          chunkText = chunkText.slice(0, lastSpaceIndex);
        }
      }

      chunks.push({
        id: randomUUID(),
        content: chunkText.trim(),
        metadata: {
          source,
          chunkIndex,
          totalChunks: 0, // Will be updated after all chunks are created
          originalLength: cleanedText.length,
        },
      });

      // Calculate advance with strong safety guarantees
      const minAdvance = Math.floor(chunkSize * 0.5); // Advance at least 50% of chunk size
      const normalAdvance = chunkText.length - chunkOverlap;
      const actualAdvance = Math.max(minAdvance, normalAdvance);

      startIndex += actualAdvance;
      chunkIndex++;
    }

    if (chunkIndex >= maxChunks) {
      console.warn(
        `⚠️  Hit maximum chunk limit (${maxChunks}) for ${source}. Text length: ${cleanedText.length}, chunk size: ${chunkSize}, overlap: ${chunkOverlap}`
      );
    }

    // Update total chunks count
    chunks.forEach((chunk) => {
      chunk.metadata.totalChunks = chunks.length;
    });

    return chunks;
  }

  /**
   * Get all supported files from a directory
   */
  private async getFiles(
    directoryPath: string,
    recursive: boolean
  ): Promise<string[]> {
    const supportedExtensions = [".txt", ".md", ".markdown", ".json"];
    const files: string[] = [];

    const items = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(directoryPath, item.name);

      if (item.isDirectory() && recursive) {
        const subFiles = await this.getFiles(fullPath, recursive);
        files.push(...subFiles);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Get collection information
   */
  async getCollectionInfo(): Promise<any> {
    return await this.chromaClient.getCollectionInfo(
      this.config.collectionName
    );
  }

  /**
   * Delete the collection (clear all indexed documents)
   */
  async clearCollection(): Promise<void> {
    await this.chromaClient.deleteCollection(this.config.collectionName);
  }

  /**
   * Close the ChromaDB connection
   */
  async close(): Promise<void> {
    await this.chromaClient.close();
  }
}
