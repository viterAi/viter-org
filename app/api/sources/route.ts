import { NextResponse } from "next/server";
import { listWhatsappChats } from "../../../lib/l0/whatsapp";

export async function GET() {
  const chats = await listWhatsappChats();

  // Shape matches what the frontend expects: id, name, key, channel
  const sources = chats.map((chat) => ({
    id: chat.id,
    name: chat.name,
    key: chat.key,
    channel: chat.channel,
  }));

  return NextResponse.json({ sources });
}
