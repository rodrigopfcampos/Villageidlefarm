// Canais Realtime do Supabase e formato das mensagens.

import type { MarketListing, PublicProfile } from './models';

export const RT_CHANNELS = {
  /** Mudanças em market_listings (postgres_changes). */
  market: 'market',
  /** Mudanças em notifications do usuário. */
  user: (uid: string) => `user:${uid}` as const,
  /** Presença de visitantes numa fazenda. */
  farm: (farmId: string) => `farm:${farmId}` as const,
} as const;

export type NotificationKind = 'market_sold' | 'visit_like' | 'visit_help' | 'system';

export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}

export interface MarketSoldPayload {
  listingId: string;
  itemId: string;
  qty: number;
  /** Moedas recebidas já descontada a taxa. */
  coins: number;
}

export interface MarketChangeMessage {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  listing: MarketListing;
}

/** Estado de presença publicado por cada visitante em farm:{farmId}. */
export type FarmPresenceState = PublicProfile & { joinedAt: number };
