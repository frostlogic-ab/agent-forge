import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

// Import common types from the new central location
import type {
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../index"; // Using the barrel file
import { BaseHandler, InputError } from "./base";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_HEADERS = {
  "HTTP-Referer": "https://agentforge.dev", // Updated referrer
  "X-Title": "Agent Forge", // Updated title
};

// Streaming helper for OpenRouter (similar to OpenAI)
async function* streamOpenRouter(
  response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): StreamCompletionResponse {
  for await (const chunk of response) {
    yield chunk;
  }
}

export class OpenRouterHandler extends BaseHandler<OpenAI> {
  // Uses OpenAI SDK client type

  // No specific validateInputs needed beyond BaseHandler for OpenAI-like params,
  // unless OpenRouter has unique constraints not covered.
  // The original staging handler had a basic super.validateInputs().

  async create(
    body: ProviderCompletionParams<"openrouter"> // Specific params for openrouter provider
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    // API key, baseURL, and defaultHeaders are now expected to be configured on `this.client` by LLMClient.
    // No need to create a new OpenAI client here or manage API key directly.

    // Remove our internal 'provider' field before passing to the SDK.
    const { provider, ...sdkCallParams } = body;

    const openAIParams: OpenAI.Chat.Completions.ChatCompletionCreateParams =
      sdkCallParams;

    if (openAIParams.stream) {
      const stream = await this.client.chat.completions.create(
        openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      );
      return streamOpenRouter(stream);
    }
    const result = await this.client.chat.completions.create(
      openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );
    return result;
  }
}
