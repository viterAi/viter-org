import { executeComposioTool } from "@/lib/composio/execute";

export type GitHubRepoSummary = {
  full_name: string;
  description: string;
  private: boolean;
  pushed_at?: string;
  owner: string;
  is_org_repo: boolean;
  /** True when GitHub reports admin permission (required for auto webhook install). */
  can_install_webhook: boolean;
};

type RawGitHubRepo = {
  full_name?: string;
  description?: string | null;
  private?: boolean;
  pushed_at?: string;
  owner?: { login?: string };
  permissions?: { admin?: boolean };
};

type RawGitHubOrg = {
  login?: string;
};

const MAX_REPOS = 500;

function reposFromPayload(data: unknown): RawGitHubRepo[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const list = record.repositories ?? record.details ?? record;
  return Array.isArray(list) ? (list as RawGitHubRepo[]) : [];
}

function orgsFromPayload(data: unknown): RawGitHubOrg[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const list = record.organizations ?? record;
  return Array.isArray(list) ? (list as RawGitHubOrg[]) : [];
}

function toSummary(repo: RawGitHubRepo, orgLogins: Set<string>): GitHubRepoSummary | null {
  const fullName = repo.full_name?.trim();
  if (!fullName) return null;
  const owner = repo.owner?.login ?? fullName.split("/")[0] ?? "";
  return {
    full_name: fullName,
    description: repo.description ?? "",
    private: Boolean(repo.private),
    pushed_at: repo.pushed_at,
    owner,
    is_org_repo: orgLogins.has(owner),
    can_install_webhook: repo.permissions?.admin === true,
  };
}

function sortRepos(repos: GitHubRepoSummary[]): GitHubRepoSummary[] {
  return [...repos].sort((a, b) => {
    const ta = a.pushed_at ? Date.parse(a.pushed_at) : 0;
    const tb = b.pushed_at ? Date.parse(b.pushed_at) : 0;
    return tb - ta;
  });
}

/** Personal, collaborator, and organization repos visible to the connected GitHub account. */
export async function listGitHubReposForConnect(
  userId: string,
  connectedAccountId: string,
): Promise<GitHubRepoSummary[]> {
  const userReposData = await executeComposioTool({
    slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    userId,
    connectedAccountId,
    arguments: { per_page: 100, sort: "pushed", type: "all", direction: "desc" },
  });

  const orgsData = await executeComposioTool({
    slug: "GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER",
    userId,
    connectedAccountId,
    arguments: { per_page: 100 },
  });

  const orgLogins = orgsFromPayload(orgsData)
    .map((o) => o.login?.trim())
    .filter((login): login is string => Boolean(login));
  const orgSet = new Set(orgLogins);

  const orgRepoBatches = await Promise.all(
    orgLogins.map(async (org) => {
      try {
        const data = await executeComposioTool({
          slug: "GITHUB_LIST_ORGANIZATION_REPOSITORIES",
          userId,
          connectedAccountId,
          arguments: {
            org,
            per_page: 100,
            sort: "pushed",
            type: "all",
            direction: "desc",
          },
        });
        return reposFromPayload(data);
      } catch {
        return [] as RawGitHubRepo[];
      }
    }),
  );

  const byName = new Map<string, GitHubRepoSummary>();
  for (const raw of [...reposFromPayload(userReposData), ...orgRepoBatches.flat()]) {
    const summary = toSummary(raw, orgSet);
    if (summary) byName.set(summary.full_name, summary);
  }

  return sortRepos([...byName.values()]).slice(0, MAX_REPOS);
}
