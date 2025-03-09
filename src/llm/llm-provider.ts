import type {
  LLMProviderConfig,
  LLMRequestOptions,
  LLMResponse,
  StreamingOptions,
} from "../types";
import { EventEmitter } from "../utils/event-emitter";

/**
 * Abstract class that defines the interface for LLM providers
 */
export abstract class LLMProvider {
  protected config: LLMProviderConfig;
  protected eventEmitter: EventEmitter;

  /**
   * Constructor for the LLM provider
   * @param config Configuration for the LLM provider
   */
  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Get the event emitter for streaming events
   */
  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
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
   * Creates a streaming chat completion using the LLM
   * Emits events for each chunk received from the LLM
   * @param options Request options including streaming options
   * @returns A promise that resolves to an LLM response when complete
   */
  abstract chatStream(
    options: LLMRequestOptions & StreamingOptions
  ): Promise<LLMResponse>;

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
