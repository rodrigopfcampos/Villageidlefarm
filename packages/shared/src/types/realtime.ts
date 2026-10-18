// Canais Realtime do Supabase e formato das mensagens.
// O canal "market" foi removido: não há mercado interno (comércio no mercado da Steam).

import type { PublicProfile } from './models';

export const RT_CHANNELS = {
  /** Mudanças em notifications do usuário. */
  user: (uid: string) => `user:${uid}` as const,
  /** Presença de visitantes numa fazenda. */
  farm: (farmId: string) => `farm:${farmId}` as const,
} as const;

export type NotificationKind =
  | 'extraction_granted'
  | 'extraction_failed'
  | 'steam_returned'
  | 'visit_like'
  | 'visit_help'
  | 'system';

export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}

/** Payload de extraction_granted / extraction_failed / steam_returned. */
export interface ExtractionNotificationPayload {
  extractionId: string;
  itemId: string;
  qty: number;
  steamItemId?: string;
}

/** Estado de presença publicado por cada visitante em farm:{farmId}. */
export type FarmPresenceState = PublicProfile & { joinedAt: number };
