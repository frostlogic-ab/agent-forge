import OpenAI from "openai";
import type { Stream } from "openai/streaming";

import type { OpenAIModel, ProviderCompletionParams } from "../types";
import type { CompletionResponse, StreamCompletionResponse } from "../types";
import { BaseHandler } from "./base";

async function* streamOpenAI(
  response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): StreamCompletionResponse {
  for await (const chunk of response) {
    yield chunk;
  }
}

export class OpenAIHandler extends BaseHandler<OpenAI> {
  async create(
    body: ProviderCompletionParams<"openai">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    const openaiClient = new OpenAI({
      ...this.opts,
      apiKey,
    });

    const { provider, ...sdkCallParams } = body;

    if (sdkCallParams.stream === true) {
      const stream = await openaiClient.chat.completions.create(
        sdkCallParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      );
      return streamOpenAI(stream);
    }
    const result = await openaiClient.chat.completions.create(
      sdkCallParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );
    return result;
  }
}
