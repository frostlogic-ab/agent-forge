import type {
  Content, // For systemInstruction
  GenerateContentStreamResult,
  GenerationConfig,
  GoogleGenerativeAI,
  Part, // For systemInstruction and our new Part
  SafetySetting,
} from "@google/generative-ai";
// Import specific OpenAI part types for processing messages
import type {
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
} from "openai/resources/chat/completions";
import type {
  ChatCompletionMessageParam,
  CompletionParams,
  CompletionResponse,
  LLMProvider,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../types";
import { BaseHandler, InputError } from "./base";
import {
  GEMINI_SAFETY_SETTINGS,
  fromGeminiResponseToLLMCompletionOutput,
  fromGeminiStreamChunkToLLMCompletionOutputChunk,
  toGeminiHistory,
  toGeminiRole,
  toGeminiTools,
} from "./gemini_utils";
import { removeEmptyParams } from "./utils";

export class GeminiHandler extends BaseHandler<GoogleGenerativeAI> {
  private providerName: LLMProvider = "gemini";

  constructor(
    client: GoogleGenerativeAI,
    options?: { provider?: LLMProvider }
  ) {
    super(client);
    if (options?.provider) {
      this.providerName = options.provider;
    }
  }

  private getModelName(params: ProviderCompletionParams<"gemini">): string {
    return params.model;
  }

  async create(
    inputParams: CompletionParams
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    if (inputParams.provider !== "gemini") {
      throw new InputError(
        `Invalid provider: expected 'gemini', got '${inputParams.provider}'`
      );
    }
    const params = inputParams as ProviderCompletionParams<"gemini">;

    const modelId = this.getModelName(params);

    let systemInstructionForGemini: string | Part | Content | undefined =
      undefined;

    const systemMessages = params.messages.filter(
      (m: ChatCompletionMessageParam) => m.role === "system"
    );
    const otherMessages = params.messages.filter(
      (m: ChatCompletionMessageParam) => m.role !== "system"
    );

    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map((m: ChatCompletionMessageParam) => {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content)) {
            let combinedText = "";
            for (const part of m.content) {
              if (part.type === "text") {
                combinedText += `${(part as ChatCompletionContentPartText).text}\n`;
              }
            }
            return combinedText.trim();
          }
          return "";
        })
        .join("\\n")
        .trim();

      if (systemText) {
        systemInstructionForGemini = systemText;
      }
    }

    const generationConfig = removeEmptyParams({
      candidateCount: params.n,
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      stopSequences:
        typeof params.stop === "string" ? [params.stop] : params.stop,
    }) as GenerationConfig;

    const generativeModel = this.client.getGenerativeModel({
      model: modelId,
      safetySettings: params.safety_settings ?? GEMINI_SAFETY_SETTINGS,
      generationConfig,
      systemInstruction: systemInstructionForGemini,
    });

    const history = toGeminiHistory(otherMessages);
    const tools = toGeminiTools(params.tools);

    let toolConfig: { functionCallingConfig: any } | undefined = undefined;
    if (params.tool_choice) {
      if (typeof params.tool_choice === "string") {
        if (params.tool_choice === "auto") {
          toolConfig = { functionCallingConfig: { mode: "AUTO" } };
        } else if (params.tool_choice === "required") {
          toolConfig = { functionCallingConfig: { mode: "ANY" } };
        } else if (params.tool_choice === "none") {
          toolConfig = { functionCallingConfig: { mode: "NONE" } };
        }
      } else if (
        typeof params.tool_choice === "object" &&
        params.tool_choice.function?.name
      ) {
        toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [params.tool_choice.function.name],
          },
        };
      } else {
        throw new InputError(
          `Invalid tool_choice format for Gemini: ${JSON.stringify(params.tool_choice)}`
        );
      }
    }

    if (params.stream) {
      const streamResult: GenerateContentStreamResult =
        await generativeModel.generateContentStream({
          contents: history,
          tools: tools,
          toolConfig: toolConfig,
        });
      return fromGeminiStreamChunkToLLMCompletionOutputChunk(
        streamResult.stream,
        modelId
      );
    }
    const result = await generativeModel.generateContent({
      contents: history,
      tools: tools as any,
      toolConfig: toolConfig as any,
    });
    return fromGeminiResponseToLLMCompletionOutput(result.response, modelId);
  }
}
