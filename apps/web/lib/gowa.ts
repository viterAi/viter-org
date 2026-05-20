/**
 * Server-side GOWA client factory.
 * Wraps the env-var contract so pages/actions don't repeat themselves.
 */

import { GowaClient, type GowaClientConfig } from '@viter-org/adapter-whatsapp-gowa';

let cached: GowaClient | null = null;

export function getGowaClient(): GowaClient {
  if (cached) return cached;
  const baseUrl = process.env.GOWA_BASE_URL;
  if (!baseUrl) throw new Error('GOWA_BASE_URL is required (configure in apps/web/.env.local)');
  const cfg: GowaClientConfig = { baseUrl };
  if (process.env.GOWA_BASIC_AUTH) cfg.basicAuth = process.env.GOWA_BASIC_AUTH;
  cached = new GowaClient(cfg);
  return cached;
}
