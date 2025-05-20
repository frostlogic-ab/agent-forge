import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

// Import common types from the new central location
import type {
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../index"; // Using the barrel file
import { BaseHandler, InputError } from "./base";

export const PERPLEXITY_API_BASE_URL = "https://api.perplexity.ai";
export const PERPLEXITY_MODEL_PREFIX = "perplexity/";

async function* streamPerplexity(
  response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): StreamCompletionResponse {
  // Directly yield the chunks as they are already in the expected format
  for await (const chunk of response) {
    yield chunk;
  }
}

export class PerplexityHandler extends BaseHandler<OpenAI> {
  // Uses OpenAI SDK client type
  async create(
    body: ProviderCompletionParams<"perplexity"> // Specific params for perplexity provider
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    // API key and baseURL are now expected to be configured on `this.client` by LLMClient.
    // No need to create a new OpenAI client here.

    const modelName = body.model.startsWith(PERPLEXITY_MODEL_PREFIX)
      ? body.model.replace(PERPLEXITY_MODEL_PREFIX, "")
      : body.model;

    // Perplexity throws an error if the temperature equals two, so if the user sets it to 2, we
    // assign it to a marginally lower value.
    const temperature =
      body.temperature === 2 ? 2 - Number.EPSILON : body.temperature;

    // Prepare the parameters for the OpenAI SDK call, removing our internal 'provider' field.
    const { provider, ...sdkCallParams } = body;

    const openAIParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      ...sdkCallParams,
      model: modelName,
      temperature,
    };

    if (openAIParams.stream) {
      const stream = await this.client.chat.completions.create(
        openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      );
      return streamPerplexity(stream);
    }
    const result = await this.client.chat.completions.create(
      openAIParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );
    return result;
  }

  // No specific validateInputs needed beyond what BaseHandler provides for OpenAI-like params, unless Perplexity has unique constraints.
  // The original didn't have a custom validateInputs.
}
