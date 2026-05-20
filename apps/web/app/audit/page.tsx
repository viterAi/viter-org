/**
 * /audit — Private engineering-audit report for Shaul.
 *
 * Password-gated (no Supabase, no email). The form + cookie logic lives in
 * `./actions.ts` and `./AuditLogin.tsx`. Anyone with the password gets in.
 *
 * Content lives at `<monorepo-root>/library/*.md` — gitignored, ships only
 * via Vercel CLI deploys. Build tracing config in `next.config.ts`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import AuditClient, {
  type AuditDocument,
  type CrossRefRegistry,
} from "./AuditClient";
import AuditLogin from "./AuditLogin";
import { getAuditViewer, signOutAudit } from "./actions";

export const metadata: Metadata = {
  title: "Viter Engineering Audit — Private",
  description:
    "Restricted-access engineering audit. Not for general distribution.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIBRARY_ROOT = path.resolve(process.cwd(), "..", "..", "library");

interface BucketSpec {
  key: string;
  label: string;
  blurb: string;
  files: { slug: string; label: string }[];
}

const BUCKETS: BucketSpec[] = [
  {
    key: "bucket-a-viter",
    label: "Bucket A — Viter-scoped detail",
    blurb:
      "19 component files. Everything I've built or touched that lives inside Viter's GitHub org, Vercel team, or Supabase org. Reusable across clients via [[adapter-pattern]].",
    files: [
      { slug: "INVENTORY", label: "INVENTORY — the index" },
      { slug: "engagement-history", label: "Engagement history (Feb→May)" },
      { slug: "vita-platform", label: "vita-platform (the ingest app)" },
      { slug: "viter-recon", label: "viter-recon (the CFO app)" },
      { slug: "desk", label: "/desk — the next-gen CFO surface ⭐" },
      { slug: "code-api-routes", label: "code/ API routes" },
      { slug: "recon-edge-functions", label: "recon edge functions" },
      { slug: "supabase-edge-functions", label: "vita edge functions" },
      { slug: "orchestrator-package", label: "@viter-org/orchestrator (Trigger.dev)" },
      { slug: "runtime-package", label: "@viter-org/runtime (extract/synth)" },
      { slug: "viter-chat-mcp", label: "viter-chat MCP server" },
      { slug: "l-pipeline", label: "L0→L1→L2→L3 pipeline" },
      { slug: "ontology", label: "Substrate ontology" },
      { slug: "adapter-pattern", label: "Adapter pattern (reusability)" },
      { slug: "clients-insperanto", label: "clients/insperanto/ (Part 5 scaffold)" },
      { slug: "deliverables", label: "deliverables/ archive" },
      { slug: "dashboards", label: "Dashboards + monitoring" },
      { slug: "tools", label: "tools/ utility scripts" },
      { slug: "shaul-brain", label: "shaul-brain (Claude-export tool)" },
    ],
  },
  {
    key: "bucket-b-personal",
    label: "Bucket B — Personal toolkit (acknowledged, not delivered)",
    blurb:
      "Mordechai's personal-stack tools that touch Viter work but live outside the Viter org. Disclosed for completeness; not billable, not in scope for handoff.",
    files: [
      { slug: "INVENTORY", label: "INVENTORY — the index" },
      { slug: "brain-mcp", label: "Brain MCP (intellectual DNA)" },
      { slug: "shelet", label: "shelet (continuous-capture)" },
      { slug: "clawd-skills", label: "clawd skills (steve familiar)" },
      { slug: "steve-identity", label: "Steve identity files" },
      { slug: "seedgarden", label: "seedgarden (idea garden)" },
      { slug: "mobile-speak", label: "mobile-speak (voice utility)" },
      { slug: "hpi-spec", label: "HPI spec (sovereign-floors substrate)" },
    ],
  },
  {
    key: "jsonl-audit",
    label: "Bucket C — JSONL session audit",
    blurb:
      "Audit of the Claude Code session JSONLs underlying the substrate (~550 MB across 106 files).",
    files: [{ slug: "INVENTORY", label: "INVENTORY" }],
  },
];

async function safeRead(rel: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(LIBRARY_ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

async function loadDocuments(): Promise<{
  main: AuditDocument;
  buckets: { spec: BucketSpec; docs: AuditDocument[] }[];
}> {
  const mainContent =
    (await safeRead("REPORT.md")) ??
    "_REPORT.md not found — likely missed by the deploy bundle._";
  const main: AuditDocument = {
    id: "REPORT",
    label: "The 8-Part Report",
    rel: "REPORT.md",
    content: mainContent,
  };

  const buckets = await Promise.all(
    BUCKETS.map(async (spec) => {
      const docs = await Promise.all(
        spec.files.map(async (f): Promise<AuditDocument> => {
          const rel = `${spec.key}/${f.slug}.md`;
          const content = (await safeRead(rel)) ?? `_${rel} not found._`;
          return {
            id: `${spec.key}/${f.slug}`,
            label: f.label,
            rel,
            content,
          };
        }),
      );
      return { spec, docs };
    }),
  );

  return { main, buckets };
}

function buildRegistry(allDocIds: string[]): CrossRefRegistry {
  const byPath: Record<string, string> = {};
  const basenameCounts: Record<string, number> = {};
  const basenameFirst: Record<string, string> = {};
  for (const id of allDocIds) {
    byPath[id] = id;
    const basename = id.includes("/") ? id.split("/").pop()! : id;
    basenameCounts[basename] = (basenameCounts[basename] ?? 0) + 1;
    if (basenameCounts[basename] === 1) basenameFirst[basename] = id;
  }
  const byBasename: Record<string, string | null> = {};
  for (const [basename, count] of Object.entries(basenameCounts)) {
    byBasename[basename] = count === 1 ? basenameFirst[basename] : null;
  }
  return { byPath, byBasename };
}

export default async function AuditPage() {
  const viewer = await getAuditViewer();
  if (!viewer) {
    return <AuditLogin />;
  }

  const { main, buckets } = await loadDocuments();
  const allDocIds = [main.id, ...buckets.flatMap((b) => b.docs.map((d) => d.id))];
  const registry = buildRegistry(allDocIds);

  return (
    <AuditClient
      viewerName={viewer}
      main={main}
      buckets={buckets.map(({ spec, docs }) => ({
        key: spec.key,
        label: spec.label,
        blurb: spec.blurb,
        docs,
      }))}
      registry={registry}
      onSignOut={signOutAudit}
    />
  );
}
