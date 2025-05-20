import type { LLMProvider } from "../../types";
import { AI21Handler } from "./ai21";
import { AnthropicHandler } from "./anthropic";
import { BaseHandler } from "./base";
import { BedrockHandler } from "./bedrock";
import { CohereHandler } from "./cohere";
import { GeminiHandler } from "./gemini";
import { GroqHandler } from "./groq";
import { MistralHandler } from "./mistral";
import { OpenAIHandler } from "./openai";
import { OpenAICompatibleHandler } from "./openai_compatible";
import { OpenRouterHandler } from "./openrouter";
import { PerplexityHandler } from "./perplexity";

import type Anthropic from "@anthropic-ai/sdk"; // Default export if that's the case
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"; // Named export
import type { GoogleGenerativeAI } from "@google/generative-ai"; // Named export
import type MistralClient from "@mistralai/mistralai"; // Added MistralClient import
import type { AI21 } from "ai21"; // Named export
import type { CohereClient } from "cohere-ai"; // Named export
// Import SDK client *types*
import type OpenAI from "openai"; // Default export if that's the case, or named: import type { OpenAI as OpenAIClient } from "openai";

// A union type for all possible SDK client instances
// This helps in typing the 'client' parameter for getHandler
// Add other client types as new handlers are integrated
type KnownSDKClients =
  | OpenAI
  | Anthropic
  | AI21
  | BedrockRuntimeClient
  | CohereClient
  | GoogleGenerativeAI
  | MistralClient; // Added MistralClient

/**
 * Retrieves the appropriate LLM handler based on the provider.
 * The main LLM client class will be responsible for instantiating the SDK client.
 *
 * @param provider The LLM provider.
 * @param client The initialized SDK client instance for the specified provider.
 * @returns An instance of the handler for the specified provider.
 * @throws Error if the provider is not supported.
 */
export function getHandler(
  provider: LLMProvider,
  client: KnownSDKClients
): BaseHandler<any> {
  // Return type is BaseHandler, actual type decided by provider
  switch (provider) {
    case "openai":
      return new OpenAIHandler(client as OpenAI);
    case "anthropic":
      return new AnthropicHandler(client as Anthropic);
    case "ai21":
      return new AI21Handler(client as AI21);
    case "bedrock":
      return new BedrockHandler(client as BedrockRuntimeClient);
    case "cohere":
      return new CohereHandler(client as CohereClient);
    case "gemini":
      return new GeminiHandler(client as GoogleGenerativeAI);
    case "mistral":
      return new MistralHandler(client as MistralClient);
    case "perplexity":
      return new PerplexityHandler(client as OpenAI);
    case "groq":
      return new GroqHandler(client as OpenAI);
    case "openrouter":
      return new OpenRouterHandler(client as OpenAI);
    case "openai-compatible":
      return new OpenAICompatibleHandler(client as OpenAI);
    // Add cases for other providers as they are integrated
    // e.g. case "mistral": return new MistralHandler(client as MistralClientType);
    default: {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}

// Re-export all handlers for direct use if needed, though getHandler is preferred.
export {
  OpenAIHandler,
  AnthropicHandler,
  AI21Handler,
  BedrockHandler,
  CohereHandler,
  GeminiHandler,
  MistralHandler,
  BaseHandler,
  PerplexityHandler,
  GroqHandler,
  OpenRouterHandler,
  OpenAICompatibleHandler,
};

export type { KnownSDKClients }; // Export the type
