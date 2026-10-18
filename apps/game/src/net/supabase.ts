// Conexão com o Supabase (só quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY existem).
// O supabase-js é carregado sob demanda: o build sem essas variáveis (API falsa) não paga o peso dele.
// Login: em desenvolvimento, anônimo; em produção a sessão virá da Edge Function steam-auth (A6).

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@vif/shared';
import type { RpcClient, RpcResponse } from './api';

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** Lê as variáveis do Vite. Sem as duas, o jogo usa a API falsa (MockApi). */
export function readSupabaseEnv(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): SupabaseEnv | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const anonKey =
    typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  return url && anonKey ? { url, anonKey } : null;
}

export class SupabaseConnection {
  private clientPromise: Promise<SupabaseClient> | null = null;
  private sessionPromise: Promise<void> | null = null;

  constructor(private readonly env: SupabaseEnv) {}

  client(): Promise<SupabaseClient> {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(this.env.url, this.env.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    );
    return this.clientPromise;
  }

  /** Garante uma sessão. Sem sessão salva: login anônimo (desenvolvimento) com o fuso do aparelho. */
  ensureSession(): Promise<void> {
    this.sessionPromise ??= (async () => {
      const c = await this.client();
      const { data } = await c.auth.getSession();
      if (data.session) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { error } = await c.auth.signInAnonymously({ options: { data: { timezone } } });
      if (error) throw new ApiError('NOT_AUTHENTICATED', error.message);
    })().catch((err: unknown) => {
      this.sessionPromise = null; // tenta de novo na próxima chamada
      throw err;
    });
    return this.sessionPromise;
  }

  /** Id do usuário logado (para o canal Realtime user:{uid}). */
  async userId(): Promise<string | null> {
    const c = await this.client();
    const { data } = await c.auth.getSession();
    return data.session?.user.id ?? null;
  }

  rpcClient(): RpcClient {
    return {
      rpc: async (fn, args) => {
        const c = await this.client();
        const { data, error } = await c.rpc(fn, args);
        return { data, error } as RpcResponse;
      },
    };
  }
}
