/**
 * LLM client — provider-agnostic, picks Anthropic by default but can fall back to OpenRouter.
 *
 * Env priority:
 *   ANTHROPIC_API_KEY   → @anthropic-ai/sdk · model 'claude-opus-4-7'
 *   OPENROUTER_API_KEY  → openai SDK with OpenRouter base URL · model from VITA_LLM_MODEL or default
 */

import Anthropic from '@anthropic-ai/sdk';

import type { LLMClient, LLMCompletionRequest, LLMCompletionResult } from './types.js';

export function createLLMClient(): LLMClient {
  if (process.env.ANTHROPIC_API_KEY) return createAnthropicClient();
  if (process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OpenRouter path not yet implemented. Set ANTHROPIC_API_KEY for now, or implement OpenRouter via openai SDK.',
    );
  }
  throw new Error(
    'No LLM API key found. Set ANTHROPIC_API_KEY (preferred) or OPENROUTER_API_KEY in .env.local.',
  );
}

function createAnthropicClient(): LLMClient {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return async (req: LLMCompletionRequest): Promise<LLMCompletionResult> => {
    const model = req.model || 'claude-opus-4-5'; // pinned default; caller usually overrides
    const response = await client.messages.create({
      model,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
    });

    // Extract text from content blocks
    const body = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    return {
      body,
      generator: anthropicModelToCanonical(response.model),
      generator_params: {
        model: response.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      },
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  };
}

function anthropicModelToCanonical(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus-4-7') || m.includes('opus-4.7')) return 'claude-opus-4-7';
  if (m.includes('sonnet-4-6') || m.includes('sonnet-4.6')) return 'claude-sonnet-4-6';
  if (m.includes('opus')) return 'claude-opus-4-7';
  if (m.includes('sonnet')) return 'claude-sonnet-4-6';
  return 'claude-opus-4-7';
}
