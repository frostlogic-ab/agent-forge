// Handler specific types originally from tokenjs_staging/handlers/types.ts
export type MessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "function" // Deprecated but kept for now
  | "developer"; // Specific to some models

export type MIMEType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// Assuming Error classes are defined within this file or are globally available
// If they were moved to a separate ./types.ts in this directory, the import should be corrected.
// For now, assuming they are part of this file as per previous refactoring stages.

// Define error classes if they are not already present from a previous step
// (Based on the summary, these were moved here from tokenjs_staging/handlers/types.ts)
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export class UnsupportedConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedConfigurationError";
  }
}

export class InvariantError extends Error {
  // Also adding InvariantError as it was part of the types moved here
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

// BaseHandler originally from tokenjs_staging/handlers/base.ts
import type {
  CompletionParams,
  CompletionResponse,
  LLMChatModel,
  ProviderCompletionParams,
  StreamCompletionResponse,
} from "../types";

export abstract class BaseHandler<ClientType> {
  protected client: ClientType;
  protected opts: any; // To store constructor options if needed by subclasses

  // Constructor can be minimal, specific SDK client setup is done by LLMClient
  constructor(client: ClientType, opts?: any) {
    this.client = client;
    this.opts = opts; // Store opts if subclasses need them (e.g. API key directly)
  }

  abstract create(
    body: CompletionParams
  ): Promise<CompletionResponse | StreamCompletionResponse>;

  protected validateInputs(originalBody: CompletionParams): void {
    // Operate on a version of the body without the 'provider' key internally for validation checks.
    const { provider, ...bodyWithoutProvider } = originalBody as any;
    // Use bodyWithoutProvider for all subsequent checks in this method.
    const body = bodyWithoutProvider;

    if (body.messages === undefined || body.messages.length === 0) {
      throw new InputError("Messages are required.");
    }

    if (body.temperature !== undefined && body.temperature !== null) {
      if (body.temperature < 0 || body.temperature > 2) {
        throw new InputError(
          "Temperature must be between 0 and 2 (inclusive)."
        );
      }
    }

    if (body.top_p !== undefined && body.top_p !== null) {
      if (body.top_p < 0 || body.top_p > 1) {
        throw new InputError("Top P must be between 0 and 1 (inclusive).");
      }
    }

    if (body.n !== undefined && body.n !== null && body.n < 1) {
      throw new InputError("N must be at least 1.");
    }

    if (
      body.max_tokens !== undefined &&
      body.max_tokens !== null &&
      body.max_tokens < 1
    ) {
      throw new InputError("Max tokens must be at least 1.");
    }

    // Validations for JSON mode (if response_format is json_object)
    if (body.response_format?.type === "json_object") {
      let containsJSONString = false;
      for (const message of body.messages) {
        if (typeof message.content === "string") {
          if (message.content.toLowerCase().includes("json")) {
            containsJSONString = true;
            break;
          }
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === "text") {
              if (part.text.toLowerCase().includes("json")) {
                containsJSONString = true;
                break;
              }
            }
          }
        }
        if (containsJSONString) break;
      }
      if (!containsJSONString) {
        // This check was specific to OpenAI's behavior. Other providers might not require "json" in the prompt.
        // Consider making this warning provider-specific or removing if too broad.
        // For now, keeping it as a general validation based on previous token.js logic.
        console.warn(
          "Warning: When 'response_format' is 'json_object', ensure your prompt instructs the model to output JSON."
        );
      }
    }

    // Note: The 'provider' property is intentionally not passed to specific SDK calls by subclasses.
  }
}
