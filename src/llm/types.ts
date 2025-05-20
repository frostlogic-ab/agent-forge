/**
 * These types are explicitly intended to be imported by the user. We keep them separate for clarity
 * and so that they can be easily imported and used alongside the primary LLM class.
 */
import type { ClientOptions } from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionTool as OpenAIChatCompletionTool,
  ChatCompletionMessageParam as OpenAICompletionMessageParam,
} from "openai/resources/index";

// Import SafetySetting for Gemini-specific params
import type { SafetySetting } from "@google/generative-ai";

export type ConfigOptions = Pick<ClientOptions, "apiKey" | "baseURL"> & {
  bedrock?: {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
};

export type ChatCompletionChoice = Omit<
  ChatCompletion.Choice,
  "finish_reason"
> & {
  finish_reason: ChatCompletion.Choice["finish_reason"] | "unknown";
};

export type ChatCompletionChunkChoice = Omit<
  ChatCompletionChunk.Choice,
  "finish_reason"
> & {
  finish_reason: ChatCompletionChunk.Choice["finish_reason"] | "unknown";
};

type CompletionResponseFields = "created" | "model" | "usage" | "object";
export type CompletionResponse = Pick<
  ChatCompletion,
  CompletionResponseFields
> & {
  id: string | null;
  choices: ChatCompletionChoice[];
};
export type CompletionResponseChunk = Pick<
  ChatCompletionChunk,
  CompletionResponseFields
> & {
  id: string | null;
  choices: ChatCompletionChunkChoice[];
};
export type StreamCompletionResponse = AsyncIterable<CompletionResponseChunk>;
export type ChatCompletionMessageParam = OpenAICompletionMessageParam;
export type ChatCompletionTool = OpenAIChatCompletionTool;

import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";
// Types from tokenjs/chat/index.ts
import type { models } from "./models_internal"; // We'll create this file next

export type OpenAIModel = (typeof models.openai.models)[number];
export type AI21Model = (typeof models.ai21.models)[number];
export type AnthropicModel = (typeof models.anthropic.models)[number];
export type GeminiModel = (typeof models.gemini.models)[number];
export type CohereModel = (typeof models.cohere.models)[number];
export type BedrockModel = (typeof models.bedrock.models)[number];
export type MistralModel = (typeof models.mistral.models)[number];
export type PerplexityModel = (typeof models.perplexity.models)[number];
export type GroqModel = (typeof models.groq.models)[number];
export type OpenRouterModel = string;
export type OpenAICompatibleModel = string;

export type LLMChatModel =
  | OpenAIModel
  | AI21Model
  | AnthropicModel
  | GeminiModel
  | CohereModel
  | BedrockModel
  | MistralModel
  | PerplexityModel
  | GroqModel
  | OpenRouterModel
  | OpenAICompatibleModel;

export type LLMProvider =
  | keyof typeof models
  | "openrouter"
  | "openai-compatible";

// Make ProviderModelMap directly indexed by LLMProvider to resolve indexing issues
type ProviderModelMap = {
  [K in LLMProvider]: K extends "openai"
    ? OpenAIModel
    : K extends "ai21"
      ? AI21Model
      : K extends "anthropic"
        ? AnthropicModel
        : K extends "gemini"
          ? GeminiModel
          : K extends "cohere"
            ? CohereModel
            : K extends "bedrock"
              ? BedrockModel
              : K extends "mistral"
                ? MistralModel
                : K extends "perplexity"
                  ? PerplexityModel
                  : K extends "groq"
                    ? GroqModel
                    : K extends "openrouter"
                      ? OpenRouterModel
                      : K extends "openai-compatible"
                        ? OpenAICompatibleModel
                        : never; // Should not be reached if LLMProvider is exhaustive
};

type CompletionBase<P extends LLMProvider> = Pick<
  ChatCompletionCreateParamsBase,
  | "temperature"
  | "top_p"
  | "stop"
  | "n"
  | "messages"
  | "max_tokens"
  | "response_format"
  | "tools"
  | "tool_choice"
  | "seed"
> & {
  provider: P;
  model: ProviderModelMap[P];
};

export type CompletionStreaming<P extends LLMProvider> = CompletionBase<P> & {
  stream: true;
  stream_options?: {
    // Added stream_options as it's used in your llm.ts
    include_usage?: boolean;
  };
};

export type CompletionNonStreaming<P extends LLMProvider> =
  CompletionBase<P> & {
    stream?: false | null;
  };

// Define Gemini-specific parameters
export type GeminiSpecificParams = {
  safety_settings?: SafetySetting[];
};

export type ProviderCompletionParams<P extends LLMProvider> = (
  | CompletionStreaming<P>
  | CompletionNonStreaming<P>
) &
  (P extends "gemini" ? GeminiSpecificParams : NonNullable<unknown>); // Use NonNullable<unknown> for {} which is better than object or {}

export type CompletionParams = {
  [P in LLMProvider]: ProviderCompletionParams<P>; // Changed to use the new ProviderCompletionParams
}[LLMProvider];

export type LLMProviderType = LLMProvider;
