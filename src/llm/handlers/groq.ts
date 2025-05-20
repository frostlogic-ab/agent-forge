import type OpenAI from "openai";
import type { Stream } from "openai/streaming"; // Although Groq might not stream JSON with stop/stream, stream type is generic

// Import common types from the new central location
import type {
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../../index"; // Using the barrel file
import { BaseHandler, InputError } from "./base";

export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";

// streamGroq could be same as streamOpenAI if Groq's stream format is identical to OpenAI's
// For now, assuming it is, as GroqHandler in staging used client.chat.completions.create(body) directly
// which implies the stream type from OpenAI SDK is compatible.
async function* streamGroq(
  response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): StreamCompletionResponse {
  for await (const chunk of response) {
    yield chunk;
  }
}

export class GroqHandler extends BaseHandler<OpenAI> {
  // Uses OpenAI SDK client type
  validateInputs(body: ProviderCompletionParams<"groq">): void {
    super.validateInputs(body); // Call base validation first

    if (body.response_format?.type === "json_object") {
      if (body.stream) {
        throw new InputError(
          `Groq does not support streaming when the 'response_format' is 'json_object'.`
        );
      }
      // Note: The original staging code had a check for `body.stop` being non-null/undefined
      // when response_format is json_object. BaseHandler's validateInputs already checks for
      // stop sequences in general, but if Groq has this specific restriction only for json_object,
      // it might need to be re-added or confirmed against Groq docs.
      // For now, relying on base validation and Groq's specific stream + json_object check.
      if (body.stop !== null && body.stop !== undefined) {
        throw new InputError(
          `Groq does not support the 'stop' parameter when the 'response_format' is 'json_object'.`
        );
      }
    }
  }

  async create(
    body: ProviderCompletionParams<"groq">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    // API key and baseURL are expected to be configured on `this.client` by LLMClient.
    const { provider, ...sdkCallParams } = body;

    const openAIParams: OpenAI.Chat.Completions.ChatCompletionCreateParams =
      sdkCallParams;

    if (openAIParams.stream) {
      // The validateInputs should prevent stream + json_object combination for Groq.
      const stream = await this.client.chat.completions.create(
        openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      );
      // If Groq's stream is identical to OpenAI's, we can reuse or inline streamOpenAI logic.
      // For now, let's define a streamGroq that mirrors it.
      return streamGroq(stream);
    }
    const result = await this.client.chat.completions.create(
      openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );
    return result;
  }
}
