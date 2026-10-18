// Escolhe a API: Supabase quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY existem; senão a MockApi
// (em memória), como sempre foi.

import type { IApi, PlotSlotDef } from '@vif/shared';
import { SupabaseApi } from './api';
import { MockApi } from './mockApi';
import { SupabaseConnection, readSupabaseEnv, type SupabaseEnv } from './supabase';

let connection: SupabaseConnection | null = null;

/** Conexão Supabase em uso (null quando o jogo está na API falsa). */
export function getSupabaseConnection(): SupabaseConnection | null {
  return connection;
}

export interface CreateApiOptions {
  /** Canteiros do layout (só a MockApi usa; no servidor eles vêm do seed). */
  slots?: PlotSlotDef[];
  /** Para testes: força as variáveis (null = sem Supabase). */
  env?: SupabaseEnv | null;
}

export function createApi(opts: CreateApiOptions = {}): IApi {
  const env = opts.env === undefined ? readSupabaseEnv() : opts.env;
  if (!env) {
    connection = null;
    return new MockApi({ slots: opts.slots });
  }
  const conn = new SupabaseConnection(env);
  connection = conn;
  return new SupabaseApi(conn.rpcClient(), { ensureSession: () => conn.ensureSession() });
}
