import { LLMProvider } from "../../types";
import * as dotenv from 'dotenv';

dotenv.config();

export const configuredProvider = (process.env.LLM_PROVIDER as LLMProvider);
export const configuredApiKey = process.env.LLM_API_KEY;
export const configuredModel = process.env.LLM_API_MODEL!;