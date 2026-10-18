// Realtime do Supabase: avisos do canal user:{uid} (tabela public.notifications, RLS só do dono).
// Ex.: subscribeUserNotifications(client, uid, (n) => bus.emit('notify:received', n))

import type { SupabaseClient } from '@supabase/supabase-js';
import { RT_CHANNELS, type NotificationKind, type NotificationRow } from '@vif/shared';

/** Linha do banco (snake_case) → NotificationRow do contrato. */
export function notificationFromRow(row: Record<string, unknown>): NotificationRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as NotificationKind,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    read: Boolean(row.read),
    createdAt: Date.parse(String(row.created_at)),
  };
}

/** Assina os avisos novos do usuário. Devolve a função que cancela. */
export function subscribeUserNotifications(
  client: SupabaseClient,
  uid: string,
  onNotification: (n: NotificationRow) => void,
): () => void {
  const channel = client
    .channel(RT_CHANNELS.user(uid))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
      (payload) => onNotification(notificationFromRow(payload.new as Record<string, unknown>)),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
