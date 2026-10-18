// Banco de verdade para os testes do servidor.
// - Local: sobe um Postgres embutido (pacote embedded-postgres, sem Docker), aplica o shim do Supabase
//   (só testes), as migrations de supabase/migrations, o seed do catálogo e os overrides de teste.
// - CI: com VIF_DB_URL (banco da Supabase CLI, migrations e seed já aplicados) só aplica os overrides.
// Variáveis: VIF_SKIP_DB=1 pula; VIF_REQUIRE_DB=1 falha em vez de pular se o banco não subir.

import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { generateSeedSql } from '../../../../../tools/seed/seedSql';
import { DEFAULT_SLOTS } from '../../../src/net/mockApi';
import type { RpcClient, RpcResponse } from '../../../src/net/api';

// int8 e numeric chegam como texto no node-pg; nos testes queremos número.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
export const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations');

export interface TestDb {
  /** Conexões como superusuário (postgres). */
  admin: pg.Pool;
  external: boolean;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

async function applyBase(admin: pg.Pool): Promise<void> {
  await admin.query(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await admin.query(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file}: ${(err as Error).message}`);
    }
  }
}

async function applyTestLayer(admin: pg.Pool): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query('select pg_advisory_lock(424242)');
    await c.query(generateSeedSql({ slots: DEFAULT_SLOTS }));
    await c.query(readFileSync(join(here, 'test-overrides.sql'), 'utf8'));
  } finally {
    await c.query('select pg_advisory_unlock(424242)').catch(() => undefined);
    c.release();
  }
}

async function startEmbedded(): Promise<TestDb> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const dir = join(tmpdir(), `vif-pg-${randomBytes(6).toString('hex')}`);
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    createPostgresUser: isRoot,
    initdbFlags: ['--locale=C', '--encoding=UTF8', '--lc-messages=C'],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await server.initialise();
  await server.start();
  const admin = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
    max: 30,
  });
  admin.on('error', () => undefined); // conexões ociosas derrubadas ao parar o banco
  try {
    await applyBase(admin);
    await applyTestLayer(admin);
  } catch (err) {
    await admin.end().catch(() => undefined);
    await server.stop().catch(() => undefined);
    throw err;
  }
  return {
    admin,
    external: false,
    async stop() {
      await admin.end().catch(() => undefined);
      await server.stop().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function connectExternal(url: string): Promise<TestDb> {
  const admin = new pg.Pool({ connectionString: url, max: 30 });
  admin.on('error', () => undefined);
  await applyTestLayer(admin);
  return {
    admin,
    external: true,
    async stop() {
      await admin.end().catch(() => undefined);
    },
  };
}

/** Sobe/conecta o banco de teste. null = sem banco (os testes do servidor são pulados). */
export async function startTestDb(): Promise<TestDb | null> {
  if (process.env.VIF_SKIP_DB === '1') return null;
  try {
    const url = process.env.VIF_DB_URL;
    return url ? await connectExternal(url) : await startEmbedded();
  } catch (err) {
    if (process.env.VIF_REQUIRE_DB === '1') throw err;
    console.warn(`[db] testes do servidor pulados: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------
// Adaptador que imita o PostgREST: 1 transação por RPC, papel authenticated (ou anon), JWT nas
// configurações, argumentos nomeados. O relógio falso e a ponte Steam vão por transação.
// ---------------------------------------------------------------------

export interface RpcContext {
  uid: string | null;
  role?: 'authenticated' | 'anon' | 'service_role';
  nowMs?: number;
  steamAvailable?: boolean;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function pgRpcClient(admin: pg.Pool, ctx: () => RpcContext): RpcClient {
  return {
    async rpc(fn, args = {}): Promise<RpcResponse> {
      const c = ctx();
      const names = Object.keys(args);
      if (!IDENT.test(fn) || !names.every((n) => IDENT.test(n))) throw new Error('nome inválido');
      const conn = await admin.connect();
      try {
        await conn.query('begin');
        const role = c.role ?? 'authenticated';
        await conn.query(
          `select set_config('request.jwt.claims', $1, true), set_config('vif.fake_now', $2, true),
                  set_config('vif.steam_available', $3, true)`,
          [
            JSON.stringify(c.uid ? { sub: c.uid, role } : { role }),
            c.nowMs === undefined ? '' : new Date(c.nowMs).toISOString(),
            c.steamAvailable === undefined ? '' : String(c.steamAvailable),
          ],
        );
        await conn.query(`set local role ${role}`);
        const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as data`;
        const r = await conn.query(
          sql,
          names.map((n) => args[n]),
        );
        await conn.query('commit');
        return { data: r.rows[0]?.data ?? null, error: null };
      } catch (err) {
        await conn.query('rollback').catch(() => undefined);
        const e = err as { message?: string; code?: string; detail?: string; hint?: string };
        return {
          data: null,
          error: {
            message: e.message ?? String(err),
            code: e.code,
            details: e.detail,
            hint: e.hint,
          },
        };
      } finally {
        conn.release();
      }
    },
  };
}
