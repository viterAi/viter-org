'use client';

/**
 * RailRealtime — keeps the channel rail live.
 *
 * Mounted in /chat/layout.tsx so it stays alive across in-app navigation.
 * Subscribes to:
 *   - l1_events INSERT (any channel, any facet) → triggers rail refresh
 *     so the latest-preview line + ordering stay current
 *   - channels UPDATE (display_name changes) → refresh so renamed groups
 *     update without a hard reload
 *
 * Implementation note: we deliberately use router.refresh() (RSC re-fetch)
 * rather than maintaining an in-memory channel list. The rail is server-
 * rendered today and the loadChannelGroups() query is fast (~50ms). A
 * 500ms debounce coalesces bursts (e.g. WhatsApp delivering a backlog).
 *
 * v0.1: anon key + no auth — listener sees everything in the project.
 * Once auth + RLS land, the subscription must be re-scoped to the
 * authenticated tenant; the topic filter and RLS policy must agree.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/browser';

const REFRESH_DEBOUNCE_MS = 500;

export function RailRealtime() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();

    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel('rail')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'l1_events' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'channels' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channels' },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
