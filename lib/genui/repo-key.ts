/** GitHub `owner/repo` external key for genui_channels. */
export const REPO_KEY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

export function normalizeRepoKey(s: string): string {
  return s.trim().toLowerCase();
}
