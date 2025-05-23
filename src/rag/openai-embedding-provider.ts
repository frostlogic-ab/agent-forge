import axios from "axios";
import type { EmbeddingProvider } from "./decorators";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "text-embedding-ada-002") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const resp = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { input: text, model: this.model },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return resp.data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const resp = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { input: texts, model: this.model },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return resp.data.data.map((d: any) => d.embedding);
  }
}
