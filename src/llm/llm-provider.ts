import {
  type LLMProviderConfig,
  type LLMRequestOptions,
  type LLMResponse,
  Message,
} from "../types";

/**
 * Abstract class that defines the interface for LLM providers
 */
export abstract class LLMProvider {
  protected config: LLMProviderConfig;

  /**
   * Constructor for the LLM provider
   * @param config Configuration for the LLM provider
   */
  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  /**
   * Completes a prompt using the LLM
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  abstract complete(options: LLMRequestOptions): Promise<LLMResponse>;

  /**
   * Creates a chat completion using the LLM
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  abstract chat(options: LLMRequestOptions): Promise<LLMResponse>;

  /**
   * Gets the available models from the provider
   * @returns A promise that resolves to a list of model IDs
   */
  abstract getAvailableModels(): Promise<string[]>;

  /**
   * Validates if a model ID is supported by this provider
   * @param modelId The model ID to validate
   * @returns True if the model is supported, false otherwise
   */
  abstract supportsModel(modelId: string): Promise<boolean>;
}
