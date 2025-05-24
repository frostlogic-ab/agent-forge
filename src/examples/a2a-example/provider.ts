import { LLM } from "../../llm/llm";
import { LLMProvider } from "../../types";

const configuredProvider = (process.env.LLM_PROVIDER as LLMProvider);
const configuredApiKey = process.env.LLM_API_KEY;
export const configuredModel = process.env.LLM_API_MODEL!;

const llmConfig = { apiKey: configuredApiKey };
export const llmProvider = new LLM(configuredProvider, llmConfig);