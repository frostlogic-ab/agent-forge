import {
  AI21,
  Anthropic,
  BedrockRuntimeClient,
  CohereClient,
  GoogleGenerativeAI,
  MistralClient,
  OpenAI,
} from "./sdks";

import { type BaseHandler, getHandler } from "./handlers";
import type { KnownSDKClients } from "./handlers";
import type {
  LLMProvider as AllLLMProviders, // All possible providers from models_internal
  ChatCompletionMessageParam, // Correct message type
  CompletionParams, // The universal parameters type for handlers
  CompletionResponse, // Correct type for non-streaming output
  StreamCompletionResponse, // Correct type for streaming output (AsyncIterable<CompletionResponseChunk>)
} from "./types";

import { GROQ_API_BASE_URL } from "./handlers/groq"; // Import Groq base URL
import {
  OPENROUTER_API_BASE_URL,
  OPENROUTER_DEFAULT_HEADERS,
} from "./handlers/openrouter"; // Import OpenRouter constants
// Import PERPLEXITY_API_BASE_URL for specific configuration
import { PERPLEXITY_API_BASE_URL } from "./handlers/perplexity";

// Define the subset of providers currently supported by LLMClient
// This makes the switch statement for SDK initialization exhaustive.
export type SupportedLLMProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "cohere"
  | "ai21"
  | "bedrock"
  | "mistral"
  | "perplexity"
  | "groq"
  | "openrouter"
  | "openai-compatible"; // Add openai-compatible

export interface LLMClientConfig {
  provider: SupportedLLMProvider;
  apiKey?: string;
  baseURL?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
}

// Input for LLMClient.create method
// Omits 'provider' (fixed by client) and ensures 'model' is a string.
// Other fields are derived from OpenAI's ChatCompletionCreateParamsBase for commonality.
import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";
export interface LLMClientCompletionInput
  extends Omit<
    ChatCompletionCreateParamsBase,
    "messages" | "model" | "provider"
  > {
  messages: ChatCompletionMessageParam[];
  model: string;
  stream?: boolean; // stream flag is part of ChatCompletionCreateParamsBase
  stream_options?: { include_usage?: boolean }; // Custom for agent-forge if needed
  // safety_settings, etc., would need to be explicitly added if the index signature is removed
  // For now, removing [key: string]: any; to aid type inference
}

export class LLMClient {
  private handler: BaseHandler<any>;
  private sdkClient: KnownSDKClients;
  public readonly provider: SupportedLLMProvider;
  public readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.provider = config.provider;

    switch (config.provider) {
      case "openai":
        if (!config.apiKey)
          throw new Error("API key is required for OpenAI provider.");
        this.sdkClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
        break;
      case "anthropic":
        if (!config.apiKey)
          throw new Error("API key is required for Anthropic provider.");
        this.sdkClient = new Anthropic({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
        break;
      case "gemini":
        if (!config.apiKey)
          throw new Error("API key is required for Gemini provider.");
        this.sdkClient = new GoogleGenerativeAI(config.apiKey);
        break;
      case "cohere":
        if (!config.apiKey)
          throw new Error("API key is required for Cohere provider.");
        this.sdkClient = new CohereClient({ token: config.apiKey });
        break;
      case "ai21":
        if (!config.apiKey)
          throw new Error("API key is required for AI21 provider.");
        this.sdkClient = new AI21({ apiKey: config.apiKey });
        break;
      case "bedrock":
        if (!config.awsRegion)
          throw new Error("AWS region is required for Bedrock provider.");
        this.sdkClient = new BedrockRuntimeClient({
          region: config.awsRegion,
          credentials:
            config.awsAccessKeyId && config.awsSecretAccessKey
              ? {
                  accessKeyId: config.awsAccessKeyId,
                  secretAccessKey: config.awsSecretAccessKey,
                }
              : undefined,
        });
        break;
      case "mistral":
        if (!config.apiKey)
          throw new Error("API key is required for Mistral provider.");
        this.sdkClient = new MistralClient({
          apiKey: config.apiKey,
          serverURL: config.baseURL,
        });
        break;
      case "perplexity":
        if (!config.apiKey) {
          // PerplexityHandler also checks PERPLEXITY_API_KEY env var if opts.apiKey is not set by LLMClient,
          // but LLMClient should enforce apiKey presence for consistency.
          throw new Error(
            "API key is required for Perplexity provider in LLMClientConfig."
          );
        }
        this.sdkClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: PERPLEXITY_API_BASE_URL, // Use Perplexity's specific baseURL
        });
        break;
      case "groq": // Add case for groq
        if (!config.apiKey) {
          throw new Error(
            "API key is required for Groq provider in LLMClientConfig."
          );
        }
        this.sdkClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: GROQ_API_BASE_URL, // Use Groq's specific baseURL
        });
        break;
      case "openrouter":
        if (!config.apiKey)
          throw new Error("API key is required for OpenRouter provider.");
        this.sdkClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: OPENROUTER_API_BASE_URL,
          defaultHeaders: OPENROUTER_DEFAULT_HEADERS,
        });
        break;
      case "openai-compatible": // Add case for openai-compatible
        if (!config.baseURL) {
          throw new Error(
            "baseURL is required for openai-compatible provider in LLMClientConfig."
          );
        }
        this.sdkClient = new OpenAI({
          apiKey: config.apiKey ?? "", // Use provided API key or default to empty string
          baseURL: config.baseURL,
        });
        break;
      default: {
        // This block should be unreachable if SupportedLLMProvider is exhaustive
        const _exhaustiveCheck: never = config.provider;
        throw new Error(
          `Unsupported LLM provider encountered in LLMClient constructor: ${_exhaustiveCheck}`
        );
      }
    }
    this.handler = getHandler(config.provider, this.sdkClient);
  }

  async create(
    params: LLMClientCompletionInput
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    const handlerInput = {
      ...params, // Spread all properties from LLMClientCompletionInput
      provider: this.provider, // Override/set provider
      model: params.model as any, // Override/set model, casting to any for ProviderModelMap compatibility
    } as CompletionParams; // Add type assertion here
    return this.handler.create(handlerInput);
  }
}
