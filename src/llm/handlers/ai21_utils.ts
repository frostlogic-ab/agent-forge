export const getTimestamp = () => {
  return Math.floor(new Date().getTime() / 1000);
};

export const consoleWarn = (message: string): void => {
  // In a real app, use a proper logger
  console.warn(`AI21Utils Warn: ${message}`);
};

export const convertMessageContentToString = (
  messageContent: any // Should be OpenAI.Chat.Completions.ChatCompletionMessageParam['content']
): string | null => {
  if (typeof messageContent === "string") {
    return messageContent;
  }
  if (Array.isArray(messageContent)) {
    // Assuming it's an array of TextPart from OpenAI spec for user messages
    return messageContent
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  // Assistant message content can be null, or other non-string/array types not handled here.
  return null;
};
