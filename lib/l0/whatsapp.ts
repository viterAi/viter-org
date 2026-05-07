import { getSupabaseAdminClient } from "../supabase/admin";
import type { SourceDataRow } from "../types/view-builder";

export type WhatsappChat = {
  id: string;
  name: string;
  key: string;
  channel: "whatsapp";
  message_count: number;
  last_active: string | null;
};

export function formatChatName(slug: string): string {
  if (slug.startsWith("wa-group-")) {
    const short = slug.replace("wa-group-", "").slice(0, 12);
    return `Group ${short}`;
  }
  if (slug.startsWith("wa-")) {
    return `+${slug.slice(3)}`;
  }
  // Named slugs like "shaul-direct", "mvp-dev"
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function listWhatsappChats(): Promise<WhatsappChat[]> {
  const supabase = getSupabaseAdminClient();

  // Fetch metadata only (no inline_text) to keep payload small
  const { data, error } = await supabase
    .from("l0_artifacts")
    .select("metadata, origin_at")
    .in("source_type", ["whatsapp_message", "whatsapp_message_live"]);

  if (error || !data) return [];

  const chatMap = new Map<string, { count: number; lastActive: string | null }>();

  for (const row of data) {
    const meta = row.metadata as Record<string, string> | null;
    const slug = meta?.chat_slug;
    if (!slug) continue;

    const existing = chatMap.get(slug);
    const at = (row.origin_at as string | null) ?? null;

    if (!existing) {
      chatMap.set(slug, { count: 1, lastActive: at });
    } else {
      existing.count++;
      if (at && (!existing.lastActive || at > existing.lastActive)) {
        existing.lastActive = at;
      }
    }
  }

  return Array.from(chatMap.entries())
    .map(([slug, { count, lastActive }]) => ({
      id: slug,
      name: formatChatName(slug),
      key: slug,
      channel: "whatsapp" as const,
      message_count: count,
      last_active: lastActive,
    }))
    .sort((a, b) => (b.last_active ?? "").localeCompare(a.last_active ?? ""));
}

/**
 * Fetch up to `limit` messages for a chat, formatted as SourceDataRow[].
 * Each row: { sender, message, timestamp, kind }
 */
export async function fetchChatMessages(
  chatSlug: string,
  limit = 400,
): Promise<SourceDataRow[]> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("l0_artifacts")
    .select("inline_text, metadata, origin_at")
    .in("source_type", ["whatsapp_message", "whatsapp_message_live"])
    .filter("metadata->>chat_slug", "eq", chatSlug)
    .order("origin_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  return data
    .filter((row) => row.inline_text)
    .map((row) => {
      const meta = (row.metadata as Record<string, string> | null) ?? {};
      return {
        sender: meta.sender_raw ?? "unknown",
        message: (row.inline_text as string).slice(0, 500),
        timestamp: (row.origin_at as string) ?? "",
        kind: meta.kind ?? "text",
      };
    });
}
