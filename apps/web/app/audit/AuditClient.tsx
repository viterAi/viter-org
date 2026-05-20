"use client";

/**
 * AuditClient — progressive-disclosure UI for the private engineering audit.
 *
 * One page. The main 8-part report is shown expanded by default. Bucket files
 * are collapsed accordions; click to expand inline. Multiple sections can be
 * open simultaneously. Desktop-only (Shaul has no mobile).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface AuditDocument {
  id: string;
  label: string;
  rel: string;
  content: string;
}

export interface AuditBucket {
  key: string;
  label: string;
  blurb: string;
  docs: AuditDocument[];
}

/**
 * Maps plain reference strings to canonical doc ids.
 *   - "bucket-a-viter/desk"  → "bucket-a-viter/desk"
 *   - "desk.md"              → "bucket-a-viter/desk"   (unambiguous basename)
 *   - "INVENTORY.md"         → null                    (ambiguous — present in 3 buckets)
 *   - "REPORT.md"            → "REPORT"
 */
export interface CrossRefRegistry {
  byPath: Record<string, string>;
  byBasename: Record<string, string | null>;
}

interface Props {
  viewerName: string;
  main: AuditDocument;
  buckets: AuditBucket[];
  registry: CrossRefRegistry;
  onSignOut: () => void | Promise<void>;
}

const ANCHOR_PREFIX = "audit-";

/** Convert a docId ("bucket-a-viter/desk") to a URL-safe anchor id ("audit-bucket-a-viter--desk"). */
function anchorIdFor(docId: string): string {
  return ANCHOR_PREFIX + docId.replace(/\//g, "--");
}

/** Inverse of anchorIdFor. */
function docIdFromAnchor(anchor: string): string | null {
  if (!anchor.startsWith(ANCHOR_PREFIX)) return null;
  return anchor.slice(ANCHOR_PREFIX.length).replace(/--/g, "/");
}

/**
 * Rewrite markdown so that references to other library files become clickable
 * anchors. We rewrite three shapes:
 *
 *   1. `bucket-a-viter/desk.md`           (backticked, with bucket prefix)
 *   2. bucket-a-viter/desk.md             (unbacked, with bucket prefix)
 *   3. `desk.md`                          (backticked basename) — only when
 *      the basename is unambiguous across buckets.
 *
 * Output: `[…](#audit-bucket-a-viter--desk)`. The Disclosure root element has
 * the matching `id`, and our custom <a> component intercepts the click to
 * open + scroll.
 */
function rewriteCrossRefs(content: string, registry: CrossRefRegistry): string {
  let out = content;

  // 1 + 2: bucket-X/slug.md (with or without backticks).
  out = out.replace(
    /(`?)(bucket-[a-z]+-[a-z]+)\/([a-z0-9_-]+)\.md\1/g,
    (full, tick, bucket, slug) => {
      const key = `${bucket}/${slug}`;
      if (!registry.byPath[key]) return full;
      const anchor = anchorIdFor(key);
      const label = tick ? `\`${bucket}/${slug}.md\`` : `${bucket}/${slug}.md`;
      return `[${label}](#${anchor})`;
    },
  );

  // 3: backticked basename only, when unambiguous.
  out = out.replace(/`([a-z0-9_-]+)\.md`/g, (full, slug) => {
    const docId = registry.byBasename[slug];
    if (!docId) return full;
    const anchor = anchorIdFor(docId);
    return `[\`${slug}.md\`](#${anchor})`;
  });

  return out;
}

export default function AuditClient({ viewerName, main, buckets, registry, onSignOut }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    [main.id]: true,
  }));

  const totalDocs = useMemo(
    () => 1 + buckets.reduce((acc, b) => acc + b.docs.length, 0),
    [buckets],
  );
  const openCount = useMemo(
    () => Object.values(open).filter(Boolean).length,
    [open],
  );

  const pendingScrollRef = useRef<string | null>(null);

  const openAndScrollTo = useCallback((docId: string) => {
    setOpen((prev) => (prev[docId] ? prev : { ...prev, [docId]: true }));
    pendingScrollRef.current = docId;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${anchorIdFor(docId)}`);
    }
  }, []);

  // After state commits, scroll the newly-opened section into view.
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) return;
    pendingScrollRef.current = null;
    const el = document.getElementById(anchorIdFor(target));
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [open]);

  // On first mount, honor any incoming #audit-... hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    const docId = docIdFromAnchor(hash);
    if (docId) openAndScrollTo(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function expandAll() {
    const all: Record<string, boolean> = { [main.id]: true };
    for (const b of buckets) for (const d of b.docs) all[d.id] = true;
    setOpen(all);
  }

  function collapseAll() {
    setOpen({});
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-5xl px-8 py-12">
        {/* Header */}
        <header className="mb-10 border-b border-zinc-200 pb-8 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            vita · /audit · restricted
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Viter Engineering Audit
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            For Shaul Levine · from Mordechai Potash · 2026-05-14
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              Signed in as: {viewerName}
            </span>
            <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {openCount} of {totalDocs} sections open
            </span>
            <button
              onClick={expandAll}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Collapse all
            </button>
            <form action={onSignOut} className="ml-auto">
              <button
                type="submit"
                className="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* The main report */}
        <section className="mb-12">
          <p className="mb-3 text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Headline
          </p>
          <Disclosure
            id={main.id}
            label={main.label}
            sublabel={main.rel}
            open={!!open[main.id]}
            onToggle={() => toggle(main.id)}
            content={main.content}
            registry={registry}
            onCrossRef={openAndScrollTo}
            featured
          />
        </section>

        {/* Buckets */}
        {buckets.map((b) => (
          <section key={b.key} className="mb-12">
            <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              {b.label}
            </p>
            <p className="mt-2 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              {b.blurb}
            </p>
            <ul className="space-y-2">
              {b.docs.map((d) => (
                <li key={d.id}>
                  <Disclosure
                    id={d.id}
                    label={d.label}
                    sublabel={d.rel}
                    open={!!open[d.id]}
                    onToggle={() => toggle(d.id)}
                    content={d.content}
                    registry={registry}
                    onCrossRef={openAndScrollTo}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Footer */}
        <footer className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            This page is restricted to Mordechai and Shaul. Not indexed. Not for
            general distribution. Source markdown lives at{" "}
            <code className="font-mono">~/viter-workspace/vita/library/</code>{" "}
            (gitignored).
          </p>
        </footer>
      </div>
    </div>
  );
}

function Disclosure(props: {
  id: string;
  label: string;
  sublabel: string;
  open: boolean;
  onToggle: () => void;
  content: string;
  registry: CrossRefRegistry;
  onCrossRef: (docId: string) => void;
  featured?: boolean;
}) {
  const {
    id,
    label,
    sublabel,
    open,
    onToggle,
    content,
    registry,
    onCrossRef,
    featured,
  } = props;

  const rewritten = useMemo(
    () => rewriteCrossRefs(content, registry),
    [content, registry],
  );

  return (
    <div
      id={anchorIdFor(id)}
      className={`scroll-mt-6 rounded-lg border ${
        featured
          ? "border-emerald-300 bg-white dark:border-emerald-800 dark:bg-zinc-900"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
        aria-expanded={open}
      >
        <span className="flex flex-col gap-0.5">
          <span
            className={`font-medium ${
              featured ? "text-base" : "text-sm"
            }`}
          >
            {label}
          </span>
          <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            {sublabel}
          </span>
        </span>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-600 transition-transform dark:border-zinc-700 dark:text-zinc-400 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-6 py-6 dark:border-zinc-800">
          <article className="prose prose-zinc max-w-none dark:prose-invert prose-headings:scroll-mt-16 prose-pre:overflow-x-auto prose-pre:text-xs prose-code:before:hidden prose-code:after:hidden prose-table:text-sm prose-th:bg-zinc-100 dark:prose-th:bg-zinc-800 prose-td:align-top prose-a:break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...rest }) => {
                  // In-page audit cross-ref → open + scroll the target section.
                  if (href?.startsWith(`#${ANCHOR_PREFIX}`)) {
                    const targetDoc = docIdFromAnchor(href.slice(1));
                    return (
                      <a
                        href={href}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                          e.preventDefault();
                          if (targetDoc) onCrossRef(targetDoc);
                        }}
                        {...rest}
                      >
                        {children}
                      </a>
                    );
                  }
                  const isExternal = href?.startsWith("http");
                  return (
                    <a
                      href={href}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noreferrer noopener" : undefined}
                      {...rest}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {rewritten}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}
