import type { MIMEType } from "./base"; // For fetchThenParseImage
import { InputError } from "./base"; // For fetchThenParseImage

// These functions were originally in tokenjs_staging/handlers/utils.ts

export const isEmptyObject = (variable: any): boolean => {
  return (
    typeof variable === "object" &&
    variable !== null &&
    Object.keys(variable).length === 0 &&
    variable.constructor === Object
  );
};

export const getTimestamp = () => {
  return Math.floor(new Date().getTime() / 1000);
};

export const fetchThenParseImage = async (
  urlOrBase64Image: string
): Promise<{ content: string; mimeType: MIMEType }> => {
  // This is a simplified version. Original uses mime-types lookup.
  if (urlOrBase64Image.startsWith("data:image/jpeg;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/jpeg" };
  }
  if (urlOrBase64Image.startsWith("data:image/png;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/png" };
  }
  // Basic fetch for URL, assuming base64 string if not a common data URI
  // This part needs robust implementation matching original token.js or using a library
  consoleWarn(
    "Image fetching for Anthropic is simplified and might not cover all cases or URL fetching correctly."
  );
  if (!urlOrBase64Image.startsWith("data:")) {
    // Rudimentary URL check
    try {
      const response = await fetch(urlOrBase64Image);
      const Mime = await import("mime-types"); // Dynamic import for mime-types
      const extension = urlOrBase64Image.split(".").pop() || "";
      const mimeType = Mime.lookup(extension) || "image/jpeg"; // Default to jpeg if lookup fails

      if (
        mimeType !== "image/jpeg" &&
        mimeType !== "image/png" &&
        mimeType !== "image/gif" &&
        mimeType !== "image/webp"
      ) {
        throw new InputError(`Unsupported MIME type: ${mimeType}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      return { content: base64, mimeType: mimeType as MIMEType };
    } catch (e) {
      throw new InputError(
        `Failed to fetch or process image URL: ${urlOrBase64Image}. Error: ${
          (e as Error).message
        }`
      );
    }
  }
  throw new InputError(
    "Invalid or unsupported image format/URL for Anthropic."
  );
};

export const consoleWarn = (message: string): void => {
  // In a real app, use a proper logger
  console.warn(`AnthropicUtils Warning: ${message}`);
};

export const convertMessageContentToString = (
  messageContent: any // Should be OpenAI.Chat.Completions.ChatCompletionMessageParam['content']
): string | null => {
  if (typeof messageContent === "string") {
    return messageContent;
  }
  if (Array.isArray(messageContent)) {
    // Assuming it's an array of TextPart, potentially other types too.
    // This needs to match how OpenAI structures multi-part content.
    return messageContent
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return null; // Or handle other content types as needed
};
