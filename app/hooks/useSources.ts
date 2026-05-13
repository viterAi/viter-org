"use client";

import { useCallback, useState } from "react";
import type { Source, SourceChannel, SourceSeedFormat, SourceTreeNode } from "../types";

const LS_SOURCE_ID = "gui:sourceId";
const LS_EXPANDED = "gui:expandedChannels";

function readLs(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function useSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [tree, setTree] = useState<SourceTreeNode[]>([]);
  // Initialize as "" on both server and client to avoid SSR hydration mismatch.
  // localStorage is restored in fetchSources after mount.
  const [sourceId, setSourceIdState] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [expandedChannels, setExpandedChannelsState] = useState<Set<string>>(new Set());

  function setSourceId(id: string) {
    writeLs(LS_SOURCE_ID, id);
    setSourceIdState(id);
  }

  function setExpandedChannels(next: Set<string> | ((prev: Set<string>) => Set<string>)) {
    setExpandedChannelsState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeLs(LS_EXPANDED, JSON.stringify([...resolved]));
      return resolved;
    });
  }
  const [createSourceOpen, setCreateSourceOpen] = useState(false);

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceKey, setNewSourceKey] = useState("");
  const [newSourceChannel, setNewSourceChannel] = useState<SourceChannel>("manual_upload");
  const [newSourceFormat, setNewSourceFormat] = useState<SourceSeedFormat>("markdown");
  const [newSourceData, setNewSourceData] = useState("");

  const fetchSources = useCallback(async () => {
    const res = await fetch("/api/sources", { cache: "no-store" });
    const json = (await res.json()) as { sources?: Source[]; tree?: SourceTreeNode[] };
    const list: Source[] = json.sources ?? [];
    const treeList: SourceTreeNode[] = json.tree ?? [];
    setSources(list);
    setTree(treeList);

    // Restore expanded channels from localStorage now that we're client-side
    const storedExpanded = readLs(LS_EXPANDED);
    if (storedExpanded) {
      try {
        setExpandedChannels(new Set<string>(JSON.parse(storedExpanded) as string[]));
      } catch { /* ignore corrupt data */ }
    }

    if (list.length > 0) {
      const persisted = readLs(LS_SOURCE_ID);
      const match = persisted ? list.find((s) => s.id === persisted) : null;
      const target = match ?? list[0];
      setSourceId(target.id);
      if (!match) {
        // First visit or stale persisted id — open the kind of the first source
        setExpandedChannels(new Set([target.channel ?? "manual_upload"]));
      }
    } else {
      // New account or no channels — do not keep the previous user's selection in memory or LS
      writeLs(LS_SOURCE_ID, "");
      setSourceIdState("");
    }
  }, []);

  async function createSource() {
    const name = newSourceName.trim();
    const key = newSourceKey.trim().toLowerCase();
    if (!name || !key) { setBusy("Source name and key are required."); return; }
    setBusy("Creating source...");
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, key, channel: newSourceChannel, seedFormat: newSourceFormat, markdown: newSourceData }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; source?: Source };
    if (!res.ok || !json.source) { setBusy(json.error ?? "Failed to create source."); return; }
    await fetchSources();
    setSourceId(json.source.id);
    setCreateSourceOpen(false);
    setNewSourceName(""); setNewSourceKey(""); setNewSourceChannel("manual_upload");
    setNewSourceFormat("markdown"); setNewSourceData(""); setBusy("");
  }

  return {
    sources, tree, sourceId, setSourceId,
    busy, setBusy,
    expandedChannels, setExpandedChannels,
    createSourceOpen, setCreateSourceOpen,
    newSourceName, setNewSourceName,
    newSourceKey, setNewSourceKey,
    newSourceChannel, setNewSourceChannel,
    newSourceFormat, setNewSourceFormat,
    newSourceData, setNewSourceData,
    fetchSources, createSource,
  };
}
