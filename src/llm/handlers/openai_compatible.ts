import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

// Import common types from the new central location
import type {
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../index";
import { BaseHandler, InputError } from "./base";

// Streaming helper (similar to OpenAI)
async function* streamOpenAICompatible(
  response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): StreamCompletionResponse {
  for await (const chunk of response) {
    yield chunk;
  }
}

export class OpenAICompatibleHandler extends BaseHandler<OpenAI> {
  // Uses OpenAI SDK client type

  // The original staging handler had a validateInputs to check for this.opts.baseURL.
  // In the new structure, LLMClient is responsible for providing a client configured with a baseURL.
  // If baseURL is essential for this handler to function, LLMClient should enforce its presence in its config for this provider.

  async create(
    body: ProviderCompletionParams<"openai-compatible"> // Specific params for openai-compatible provider
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body); // Basic validation from BaseHandler

    // API key and baseURL are expected to be configured on `this.client` by LLMClient.
    // The LLMClient will handle the logic for determining the API key, including defaulting to "" if necessary for this provider.

    // Remove our internal 'provider' field before passing to the SDK.
    const { provider, ...sdkCallParams } = body;

    const openAIParams: OpenAI.Chat.Completions.ChatCompletionCreateParams =
      sdkCallParams;

    if (openAIParams.stream) {
      const stream = await this.client.chat.completions.create(
        openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      );
      return streamOpenAICompatible(stream);
    }
    const result = await this.client.chat.completions.create(
      openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );
    return result;
  }
}
