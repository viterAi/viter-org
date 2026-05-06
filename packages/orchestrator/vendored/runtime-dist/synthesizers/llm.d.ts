/**
 * LLM client — provider-agnostic, env-driven priority.
 *
 * Priority order (first non-empty env wins):
 *   1. OPENROUTER_API_KEY  → openai SDK with OpenRouter base URL · model-agnostic
 *   2. ANTHROPIC_API_KEY   → @anthropic-ai/sdk · Anthropic-only
 *
 * Model strings:
 *   OpenRouter format: 'anthropic/claude-opus-4-5', 'openai/gpt-5', 'google/gemini-3-pro', …
 *   Anthropic format:  'claude-opus-4-5'
 *
 * The synthesizer should pass an OpenRouter-format model name; the Anthropic adapter
 * strips the 'anthropic/' prefix automatically.
 */
import type { LLMClient } from './types.js';
export declare function createLLMClient(): LLMClient;
//# sourceMappingURL=llm.d.ts.map