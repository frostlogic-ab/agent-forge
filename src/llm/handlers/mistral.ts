import type MistralClient from "@mistralai/mistralai";
import type {
  ChatCompletionMessageParam,
  // ChatCompletionMessageToolCall, // Already in mistral_utils if needed for response conversion
} from "openai/resources/index";

import type {
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../types";
import { BaseHandler, InputError } from "./base";
import {
  convertMessages,
  convertToolCallsToMistral, // For request
  convertToolConfig,
  toCompletionResponse,
  toStreamResponse,
  // convertMistralToolCallsToOpenAI, // For response, handled in toCompletionResponse
} from "./mistral_utils";
import { removeEmptyParams } from "./utils";

export class MistralHandler extends BaseHandler<MistralClient> {
  private prepareChatParams(
    body: ProviderCompletionParams<"mistral">
  ): Parameters<MistralClient["chat"]>[0] {
    // Destructure all properties from body that are used for params
    const {
      model,
      messages,
      temperature,
      max_tokens,
      top_p,
      seed,
      tool_choice,
      tools,
      response_format,
    } = body;

    const { toolChoice: convertedToolChoice, tools: convertedTools } =
      convertToolConfig(tool_choice, tools);

    // Construct the parameters object.
    // `model` and `messages` are required and sourced directly.
    // Other optional parameters are processed by `removeEmptyParams`.
    const params: Parameters<MistralClient["chat"]>[0] = {
      model, // Directly from body, type MistralModel (string union)
      messages: convertMessages(
        messages as ChatCompletionMessageParam[]
      ) as any, // Result of convertMessages
      // Spread the cleaned optional parameters
      ...removeEmptyParams({
        temperature: temperature ?? undefined,
        maxTokens: max_tokens ?? undefined,
        topP: top_p ?? undefined,
        randomSeed: seed ?? undefined,
        safePrompt: false, // Default or make configurable
        toolChoice: convertedToolChoice as any,
        tools: convertedTools as any,
        responseFormat: response_format?.type
          ? { type: response_format.type as any }
          : undefined,
      }),
    };

    return params;
  }

  async create(
    body: ProviderCompletionParams<"mistral">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);
    const createdTimestamp = Math.floor(Date.now() / 1000);

    const chatParams = this.prepareChatParams(body);

    if (body.stream) {
      try {
        const streamResult = await this.client.chatStream(chatParams);
        return toStreamResponse(
          streamResult,
          createdTimestamp,
          chatParams.model
        );
      } catch (e: any) {
        // TODO: Better error handling, map Mistral errors to our error types
        throw new Error(`Mistral API error: ${e.message}`);
      }
    } else {
      try {
        const result = await this.client.chat(chatParams);
        return toCompletionResponse(result, createdTimestamp);
      } catch (e: any) {
        // TODO: Better error handling
        throw new Error(`Mistral API error: ${e.message}`);
      }
    }
  }

  protected validateInputs(body: ProviderCompletionParams<"mistral">): void {
    super.validateInputs(body);
    if (body.n && body.n > 1) {
      throw new InputError(
        "Mistral does not support n > 1 for chat completions."
      );
    }
    // `stop` sequences are not directly supported in Mistral API params,
    // could be handled client-side if necessary or documented as unsupported.
  }
}
