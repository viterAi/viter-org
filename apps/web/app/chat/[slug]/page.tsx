/**
 * /chat/[slug] — conversation view for one channel.
 */

import { notFound } from 'next/navigation';
import { ConversationView } from '../ConversationView';
import { loadChannelBySlug } from '@/lib/chat/queries';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const channel = await loadChannelBySlug(decoded);
  if (!channel) notFound();
  return <ConversationView channel={channel} />;
}
