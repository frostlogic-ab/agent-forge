import type { BedrockModel, LLMProvider } from "../types"; // BedrockModel is the specific model type for Bedrock
import type { MIMEType } from "./base"; // For fetchThenParseImage
import { InputError } from "./base"; // For fetchThenParseImage

export const getTimestamp = () => {
  return Math.floor(new Date().getTime() / 1000);
};

export const consoleWarn = (message: string): void => {
  // In a real app, use a proper logger
  console.warn(`BedrockUtils Warn: ${message}`);
};

export const convertMessageContentToString = (
  messageContent: any // Should be OpenAI.Chat.Completions.ChatCompletionMessageParam['content']
): string | null => {
  if (typeof messageContent === "string") {
    return messageContent;
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return null;
};

export const isEmptyObject = (variable: any): boolean => {
  return (
    typeof variable === "object" &&
    variable !== null &&
    Object.keys(variable).length === 0 &&
    variable.constructor === Object
  );
};

export const fetchThenParseImage = async (
  urlOrBase64Image: string
): Promise<{ content: string; mimeType: MIMEType }> => {
  if (urlOrBase64Image.startsWith("data:image/jpeg;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/jpeg" };
  }
  if (urlOrBase64Image.startsWith("data:image/png;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/png" };
  }
  if (urlOrBase64Image.startsWith("data:image/gif;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/gif" };
  }
  if (urlOrBase64Image.startsWith("data:image/webp;base64,")) {
    return { content: urlOrBase64Image.split(",")[1], mimeType: "image/webp" };
  }

  consoleWarn(
    "Image fetching for Bedrock is simplified and might not cover all cases or URL fetching correctly if not a data URI."
  );
  if (!urlOrBase64Image.startsWith("data:")) {
    try {
      const response = await fetch(urlOrBase64Image);
      if (!response.ok) {
        throw new InputError(
          `Failed to fetch image URL: ${response.statusText}`
        );
      }
      const Mime = await import("mime-types");
      const extension = urlOrBase64Image.split(".").pop() || "";
      const mimeTypeLookup =
        Mime.lookup(extension) || "application/octet-stream";

      const validMimeTypes: MIMEType[] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      if (!validMimeTypes.includes(mimeTypeLookup as MIMEType)) {
        throw new InputError(
          `Unsupported MIME type: ${mimeTypeLookup} from URL ${urlOrBase64Image}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      return { content: base64, mimeType: mimeTypeLookup as MIMEType };
    } catch (e) {
      throw new InputError(
        `Failed to fetch or process image URL: ${urlOrBase64Image}. Error: ${(e as Error).message}`
      );
    }
  }
  throw new InputError(
    "Invalid or unsupported image format/URL for Bedrock. Must be a data URI or a fetchable public URL."
  );
};

export const normalizeTemperature = (temperature: number): number => {
  if (temperature < 0) return 0;
  if (temperature > 1) {
    // If the original scale was 0-2 (like OpenAI), we could divide by 2.
    // For now, let's just clamp to 1, as most Bedrock models specify 0-1.
    // consoleWarn(`Temperature ${temperature} is outside Bedrock\'s typical 0-1 range. Clamping to 1.`);
    return 1;
  }
  return temperature;
};
