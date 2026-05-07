import { createClient } from "@supabase/supabase-js";
import type { SourceDataRow } from "../types/view-builder";

function getDataClient() {
  const url = process.env.L0_SUPABASE_URL;
  const key = process.env.L0_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing L0_SUPABASE_URL or L0_SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

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
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function listWhatsappChats(): Promise<WhatsappChat[]> {
  const supabase = getDataClient();

  const { data, error } = await supabase.rpc("list_whatsapp_chats");

  if (error || !data) return [];

  return (data as Array<{
    id: string; name: string; key: string;
    channel: string; message_count: number; last_active: string | null;
  }>).map((row) => ({
    id: row.id,
    name: formatChatName(row.id),
    key: row.key,
    channel: "whatsapp" as const,
    message_count: Number(row.message_count),
    last_active: row.last_active,
  }));
}

export async function fetchChatMessages(
  chatSlug: string,
  limit = 400,
): Promise<SourceDataRow[]> {
  const supabase = getDataClient();

  const { data, error } = await supabase.rpc("fetch_chat_messages", {
    p_chat_slug: chatSlug,
    p_limit: limit,
  });

  if (error || !data) return [];

  return (data as Array<{
    sender: string; message: string; sent_at: string; kind: string;
  }>).map((row) => ({
    sender: row.sender,
    message: row.message,
    timestamp: row.sent_at,
    kind: row.kind,
  }));
}
