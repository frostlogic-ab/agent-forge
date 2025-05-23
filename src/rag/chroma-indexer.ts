import axios from "axios";
import type { EmbeddingProvider } from "./decorators";

export class ChromaIndexer {
  constructor(
    private chromaUrl: string,
    private embeddingProvider: EmbeddingProvider,
    private collection = "default"
  ) {}

  async addDocuments(docs: { id: string; text: string }[]) {
    const texts = docs.map((d) => d.text);
    const embeddings = this.embeddingProvider.embedBatch
      ? await this.embeddingProvider.embedBatch(texts)
      : await Promise.all(texts.map((t) => this.embeddingProvider.embed(t)));
    const payload = docs.map((doc, i) => ({
      id: doc.id,
      embedding: embeddings[i],
      metadata: { text: doc.text },
    }));
    await axios.post(
      `${this.chromaUrl}/api/v1/collections/${this.collection}/upsert`,
      {
        documents: payload,
      }
    );
  }

  async search(query: string, topK = 3) {
    const embedding = await this.embeddingProvider.embed(query);
    const resp = await axios.post(
      `${this.chromaUrl}/api/v1/collections/${this.collection}/query`,
      {
        query_embeddings: [embedding],
        n_results: topK,
        include: ["metadatas", "distances", "documents"],
      }
    );
    return resp.data.documents[0].map((_doc: any, i: number) => ({
      id: resp.data.ids[0][i],
      text: resp.data.metadatas[0][i].text,
      score: resp.data.distances[0][i],
    }));
  }
}
