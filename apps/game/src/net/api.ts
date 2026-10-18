// IApi de verdade: cada método chama 1 RPC do Postgres (Supabase) e devolve o JSON como veio.
// O servidor decide tudo; aqui só há tradução de nomes (camelCase → snake_case) e de erros.
// O transporte é qualquer objeto com `rpc(nome, args)` (supabase-js, ou o adaptador pg dos testes).

import {
  ApiError,
  RPC_NAMES,
  toApiError,
  type Album,
  type BootstrapResult,
  type BuyAnimalParams,
  type CardActivateParams,
  type ClaimNightEventParams,
  type ClaimNightEventResult,
  type CollectAnimalParams,
  type Extraction,
  type ExtractionQuota,
  type ExtractionRequestParams,
  type ExtractionResult,
  type HarvestAllParams,
  type HarvestParams,
  type HeartbeatResult,
  type IApi,
  type MutationResult,
  type Page,
  type PlantParams,
  type Profile,
  type PublicFarmSnapshot,
  type ServerTime,
  type SetTimezoneParams,
  type ShopTradeParams,
  type SteamReturnResult,
  type SteamReturnSyncParams,
  type UnlockSlotParams,
  type VisitCandidate,
  type VisitInteractParams,
  type WorldState,
} from '@vif/shared';

/** Erro como o PostgREST/supabase-js devolve. */
export interface RpcError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface RpcResponse {
  data: unknown;
  error: RpcError | null;
}

/** O mínimo do supabase-js que a API usa. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResponse>;
}

/** Converte o erro do RPC no ApiError do contrato (o SQL lança `raise exception '<CODE>'`). */
export function rpcErrorToApiError(e: RpcError): ApiError {
  const parsed = toApiError(e.message ?? '');
  if (parsed.code !== 'UNKNOWN') return parsed;
  const code = e.code ?? '';
  const msg = e.message ?? '';
  // JWT ausente/expirado (PostgREST) ou função negada para anon
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501' || /jwt/i.test(msg)) {
    return new ApiError('NOT_AUTHENTICATED', msg);
  }
  if (/fetch|network|Failed to fetch|ECONNREFUSED|timeout/i.test(msg)) {
    return new ApiError('NETWORK_ERROR', msg);
  }
  return parsed;
}

export interface SupabaseApiOptions {
  /** Garante a sessão (login) antes de cada chamada. */
  ensureSession?: () => Promise<void>;
}

export class SupabaseApi implements IApi {
  constructor(
    private readonly client: RpcClient,
    private readonly opts: SupabaseApiOptions = {},
  ) {}

  private async call<T>(
    method: keyof typeof RPC_NAMES,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    let res: RpcResponse;
    try {
      if (this.opts.ensureSession) await this.opts.ensureSession();
      res = await this.client.rpc(RPC_NAMES[method], args);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('NETWORK_ERROR', err instanceof Error ? err.message : String(err));
    }
    if (res.error) throw rpcErrorToApiError(res.error);
    return res.data as T;
  }

  // ---------- núcleo ----------
  bootstrap(): Promise<BootstrapResult> {
    return this.call('bootstrap');
  }
  heartbeat(): Promise<HeartbeatResult> {
    return this.call('heartbeat');
  }
  getServerTime(): Promise<ServerTime> {
    return this.call('getServerTime');
  }
  plant(p: PlantParams): Promise<MutationResult> {
    return this.call('plant', {
      slot_id: p.slotId,
      seed_item_id: p.seedItemId,
      request_id: p.requestId,
    });
  }
  harvest(p: HarvestParams): Promise<MutationResult> {
    return this.call('harvest', { slot_id: p.slotId, request_id: p.requestId });
  }
  harvestAll(p: HarvestAllParams): Promise<MutationResult> {
    return this.call('harvestAll', { request_id: p.requestId });
  }
  unlockSlot(p: UnlockSlotParams): Promise<MutationResult> {
    return this.call('unlockSlot', { slot_id: p.slotId, request_id: p.requestId });
  }
  buyAnimal(p: BuyAnimalParams): Promise<MutationResult> {
    return this.call('buyAnimal', { animal_type: p.animalType, request_id: p.requestId });
  }
  collectAnimal(p: CollectAnimalParams): Promise<MutationResult> {
    return this.call('collectAnimal', { animal_id: p.animalId, request_id: p.requestId });
  }
  shopBuy(p: ShopTradeParams): Promise<MutationResult> {
    return this.call('shopBuy', { item_id: p.itemId, qty: p.qty, request_id: p.requestId });
  }
  shopSell(p: ShopTradeParams): Promise<MutationResult> {
    return this.call('shopSell', { item_id: p.itemId, qty: p.qty, request_id: p.requestId });
  }

  // ---------- cartas ----------
  cardActivate(p: CardActivateParams): Promise<MutationResult> {
    return this.call('cardActivate', { instance_id: p.instanceId, request_id: p.requestId });
  }
  albumGet(): Promise<Album> {
    return this.call('albumGet');
  }

  // ---------- tempo e evento ----------
  getWorldState(): Promise<WorldState> {
    return this.call('getWorldState');
  }
  setTimezone(p: SetTimezoneParams): Promise<Profile> {
    return this.call('setTimezone', { tz: p.tz, request_id: p.requestId });
  }
  claimNightEvent(p: ClaimNightEventParams): Promise<ClaimNightEventResult> {
    return this.call('claimNightEvent', { request_id: p.requestId });
  }

  // ---------- Steam ----------
  extractionQuota(): Promise<ExtractionQuota> {
    return this.call('extractionQuota');
  }
  extractionRequest(p: ExtractionRequestParams): Promise<ExtractionResult> {
    return this.call('extractionRequest', {
      item_id: p.itemId,
      qty: p.qty,
      request_id: p.requestId,
    });
  }
  extractionList(): Promise<Extraction[]> {
    return this.call('extractionList');
  }
  steamReturnSync(p: SteamReturnSyncParams): Promise<SteamReturnResult> {
    return this.call('steamReturnSync', {
      steam_item_ids: p.steamItemIds,
      request_id: p.requestId,
    });
  }

  // ---------- visitas (agente A7; ainda sem RPC no banco) ----------
  visitListCandidates(_page: number): Promise<Page<VisitCandidate>> {
    return this.notImplemented('visitListCandidates');
  }
  visitGetFarm(_hostId: string): Promise<PublicFarmSnapshot> {
    return this.notImplemented('visitGetFarm');
  }
  visitInteract(_p: VisitInteractParams): Promise<MutationResult> {
    return this.notImplemented('visitInteract');
  }

  private notImplemented(op: string): Promise<never> {
    return Promise.reject(new ApiError('NOT_IMPLEMENTED', `${op} ainda não existe no servidor`));
  }
}
