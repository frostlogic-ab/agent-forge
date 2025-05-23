import axios from "axios";
import type { EmbeddingProvider } from "./decorators";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "models/embedding-001") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/${this.model}:embedText?key=${this.apiKey}`,
      { text },
      { headers: { "Content-Type": "application/json" } }
    );
    return resp.data.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
