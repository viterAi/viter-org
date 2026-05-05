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
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
const DEFAULT_MODEL_OPENROUTER = 'anthropic/claude-opus-4-5';
const DEFAULT_MODEL_ANTHROPIC = 'claude-opus-4-5';
export function createLLMClient() {
    if (process.env.OPENROUTER_API_KEY)
        return createOpenRouterClient();
    if (process.env.ANTHROPIC_API_KEY)
        return createAnthropicClient();
    throw new Error('No LLM API key found. Set OPENROUTER_API_KEY (preferred — model-agnostic) ' +
        'or ANTHROPIC_API_KEY in .env.local.\n' +
        'For viter: copy from `vercel env pull` against the viter project.');
}
// ────────────────────────────────────────────────────────────────────
// OpenRouter (OpenAI-compatible)
// ────────────────────────────────────────────────────────────────────
function createOpenRouterClient() {
    const client = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
            'HTTP-Referer': 'https://vita.viter.ai',
            'X-Title': 'Vita Substrate',
        },
    });
    return async (req) => {
        const model = req.model || DEFAULT_MODEL_OPENROUTER;
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: req.systemPrompt },
                { role: 'user', content: req.userPrompt },
            ],
            max_tokens: req.maxTokens ?? 4096,
            temperature: req.temperature ?? 0.2,
        });
        const choice = response.choices[0];
        const body = (choice?.message?.content ?? '').trim();
        const usedModel = response.model ?? model;
        const generationId = response.id ?? null;
        return {
            body,
            generator: openrouterModelToCanonical(usedModel),
            model_used: usedModel,
            provider_name: 'openrouter',
            generation_id: generationId,
            finish_reason: choice?.finish_reason ?? null,
            generator_params: {
                provider: 'openrouter',
                model: usedModel,
                max_tokens: req.maxTokens ?? 4096,
                temperature: req.temperature ?? 0.2,
            },
            usage: response.usage,
        };
    };
}
function openrouterModelToCanonical(model) {
    const m = model.toLowerCase();
    if (m.includes('claude-opus-4-7') || m.includes('claude-opus-4.7'))
        return 'claude-opus-4-7';
    if (m.includes('claude-opus-4-5') || m.includes('claude-opus-4.5'))
        return 'claude-opus-4-7'; // map to seeded principal
    if (m.includes('claude-sonnet-4-6') || m.includes('claude-sonnet-4.6'))
        return 'claude-sonnet-4-6';
    if (m.includes('claude-opus'))
        return 'claude-opus-4-7';
    if (m.includes('claude-sonnet'))
        return 'claude-sonnet-4-6';
    if (m.includes('gpt-5'))
        return 'gpt-5';
    if (m.includes('gemini'))
        return 'gemini-3-pro';
    return 'claude-opus-4-7';
}
// ────────────────────────────────────────────────────────────────────
// Anthropic SDK (direct)
// ────────────────────────────────────────────────────────────────────
function createAnthropicClient() {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return async (req) => {
        // Strip OpenRouter-format vendor prefix if passed
        const model = (req.model || DEFAULT_MODEL_ANTHROPIC).replace(/^anthropic\//, '');
        const response = await client.messages.create({
            model,
            system: req.systemPrompt,
            messages: [{ role: 'user', content: req.userPrompt }],
            max_tokens: req.maxTokens ?? 4096,
            temperature: req.temperature ?? 0.2,
        });
        const body = response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
        return {
            body,
            generator: openrouterModelToCanonical(response.model),
            model_used: response.model,
            provider_name: 'anthropic',
            generation_id: response.id ?? null,
            finish_reason: response.stop_reason ?? null,
            generator_params: {
                provider: 'anthropic',
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
//# sourceMappingURL=llm.js.map