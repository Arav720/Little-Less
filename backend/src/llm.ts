// One OpenAI-compatible client. Works with Gemini (default) or OpenAI by changing .env only.
import OpenAI from 'openai';
import { config } from './config.js';

export const llm = new OpenAI({
  apiKey: config.llm.apiKey || 'missing-key',
  baseURL: config.llm.baseUrl,
});

export const MODEL = config.llm.model;
