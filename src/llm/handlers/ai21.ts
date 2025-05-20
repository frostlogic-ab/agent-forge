import type { AI21 } from "ai21";
import type {
  AI21Model,
  CompletionParams,
  LLMChatModel,
  ProviderCompletionParams,
} from "../types";
import type {
  ChatCompletionChoice,
  ChatCompletionChunkChoice,
  CompletionResponse,
  StreamCompletionResponse,
} from "../types";
import {
  consoleWarn,
  convertMessageContentToString,
  getTimestamp,
} from "./ai21_utils";
import { BaseHandler, InputError } from "./base";

// AI21 specific types (internal to this handler)
type AI21ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type AI21ChatCompletionParams = {
  model: string;
  messages: AI21ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  n?: number;
  stream?: boolean;
};

type AI21ChatCompletionResponseNonStreaming = {
  id: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length";
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type AI21ChatCompletionResponseStreamingChunk = {
  id: string;
  choices: [
    {
      index: number;
      delta: { role?: "assistant"; content?: string };
      finish_reason: "stop" | "length" | null;
    },
  ];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// Helper function to convert OpenAI messages to AI21 format
const convertMessagesToAI21Params = (
  messages: CompletionParams["messages"]
): AI21ChatMessage[] => {
  const output: AI21ChatMessage[] = [];
  let previousRole: "user" | "assistant" = "user";
  let currentMessageContentParts: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const messageContentString =
      convertMessageContentToString(message.content) ?? "";

    if (message.role === "system") {
      if (i === 0) {
        output.push({
          role: "system",
          content: messageContentString,
        });
      } else {
        currentMessageContentParts.push(`System: ${messageContentString}`);
      }
    } else if (message.role === "user" || message.role === "assistant") {
      const newRole = message.role;
      if (previousRole !== newRole && currentMessageContentParts.length > 0) {
        output.push({
          role: previousRole,
          content: currentMessageContentParts.join("\n"),
        });
        currentMessageContentParts = [];
      }
      currentMessageContentParts.push(messageContentString);
      previousRole = newRole;
    } else if (message.role === "tool") {
      consoleWarn(
        "AI21 does not directly support tool messages. Converting to user message."
      );
      const toolContent = `Tool call ID ${message.tool_call_id}: ${messageContentString}`;
      if (
        previousRole === "assistant" &&
        currentMessageContentParts.length > 0
      ) {
        output.push({
          role: "assistant",
          content: currentMessageContentParts.join("\n"),
        });
        currentMessageContentParts = [];
      }
      currentMessageContentParts.push(toolContent);
      previousRole = "user";
    }
  }

  if (currentMessageContentParts.length > 0) {
    output.push({
      role: previousRole,
      content: currentMessageContentParts.join("\n"),
    });
  }
  return output;
};

// Helper function to stream and parse AI21 response
async function* streamAI21Response(
  responseStream: ReadableStream<Uint8Array>,
  modelId: LLMChatModel, // model from request body
  createdTimestamp: number
): StreamCompletionResponse {
  const reader = responseStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "data: [DONE]") {
          return;
        }
        if (line.trim().startsWith("data:")) {
          const chunkData: AI21ChatCompletionResponseStreamingChunk =
            JSON.parse(line.replace(/^data:\s*/, "").trim());
          const choice = chunkData.choices[0];
          const streamingChoice: ChatCompletionChunkChoice = {
            index: 0,
            delta: {
              role:
                (choice?.delta?.role as "assistant" | undefined) ?? "assistant",
              content: choice?.delta?.content ?? "",
            },
            finish_reason: choice.finish_reason ?? "unknown", // Handle null finish_reason
            logprobs: null,
          };
          yield {
            id: chunkData.id,
            choices: [streamingChoice],
            created: createdTimestamp,
            model: modelId,
            object: "chat.completion.chunk",
            usage: chunkData.usage
              ? {
                  prompt_tokens: chunkData.usage.prompt_tokens,
                  completion_tokens: chunkData.usage.completion_tokens,
                  total_tokens:
                    chunkData.usage.prompt_tokens +
                    chunkData.usage.completion_tokens,
                }
              : undefined,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Helper function to convert AI21 non-streaming response to standard CompletionResponse
function convertAI21ResponseToCompletionResponse(
  ai21Response: AI21ChatCompletionResponseNonStreaming,
  modelId: LLMChatModel, // model from request body
  createdTimestamp: number
): CompletionResponse {
  const choices: ChatCompletionChoice[] = ai21Response.choices.map(
    (choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        refusal: null,
      },
      finish_reason: choice.finish_reason,
      logprobs: null,
    })
  );

  return {
    id: ai21Response.id,
    choices,
    created: createdTimestamp,
    model: modelId, // AI21 response doesn't include model name
    object: "chat.completion",
    usage: {
      prompt_tokens: ai21Response.usage.prompt_tokens,
      completion_tokens: ai21Response.usage.completion_tokens,
      total_tokens: ai21Response.usage.total_tokens,
    },
  };
}

export class AI21Handler extends BaseHandler<AI21> {
  validateInputs(body: ProviderCompletionParams<"ai21">): void {
    super.validateInputs(body);
    if (
      body.n !== undefined &&
      body.n !== null &&
      (body.n < 0 || body.n > 16)
    ) {
      throw new InputError(
        `AI21 requires 'n' to be between 0 and 16. Got: ${body.n}`
      );
    }
    if (body.stream && body.n !== undefined && body.n !== null && body.n > 1) {
      throw new InputError(
        `AI21 requires 'n' to be 1 when streaming. Got: ${body.n}`
      );
    }
    // AI21 does not support 'tools' or 'tool_choice' via this API endpoint
    if (body.tools || body.tool_choice) {
      consoleWarn(
        "AI21Handler: 'tools' and 'tool_choice' are not supported by this AI21 endpoint and will be ignored."
      );
    }
  }

  async create(
    body: ProviderCompletionParams<"ai21">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    const apiKey = this.opts.apiKey ?? process.env.AI21_API_KEY;
    if (!apiKey) {
      throw new InputError(
        "AI21_API_KEY not found. Please set it or pass apiKey in options."
      );
    }

    const ai21Messages = convertMessagesToAI21Params(body.messages);
    const params: AI21ChatCompletionParams = {
      model: body.model,
      messages: ai21Messages,
      max_tokens: body.max_tokens ?? undefined,
      temperature: body.temperature === null ? undefined : body.temperature,
      top_p: body.top_p === null ? undefined : body.top_p,
      stop: body.stop ?? undefined,
      n: body.n ?? undefined,
      stream: body.stream ?? false,
    };

    const created = getTimestamp();
    const response = await fetch(
      "https://api.ai21.com/studio/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI21 API error (${response.status}): ${errorBody}`);
    }

    if (params.stream) {
      if (!response.body) {
        throw new Error("AI21 stream response body is null.");
      }
      return streamAI21Response(response.body, body.model, created);
    }

    const jsonResponse =
      (await response.json()) as AI21ChatCompletionResponseNonStreaming;
    return convertAI21ResponseToCompletionResponse(
      jsonResponse,
      body.model,
      created
    );
  }
}
