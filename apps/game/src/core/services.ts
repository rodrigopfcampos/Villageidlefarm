// Liga as peças do cliente: bus + store + api. Criado no Boot e lido pelas cenas com getServices().
// Hoje usa sempre a MockApi; o agente Servidor (A2) troca por net/api.ts quando existir.

import { ECONOMY, layoutPlotSlots, toApiError, type FarmLayout, type IApi } from '@vif/shared';
import { bus, type EventBus } from './bus';
import { ClientStore } from './store';
import { MockApi } from '../net/mockApi';

export interface Services {
  bus: EventBus;
  store: ClientStore;
  api: IApi;
  layout: FarmLayout | null;
}

let current: Services | null = null;

export function createServices(layout: FarmLayout | null, api?: IApi): Services {
  const realApi = api ?? new MockApi({ slots: layout ? layoutPlotSlots(layout) : undefined });
  current = { bus, store: new ClientStore(bus), api: realApi, layout };
  return current;
}

export function getServices(): Services {
  if (!current) throw new Error('Services ainda não criados (Boot não rodou)');
  return current;
}

/**
 * Chama uma operação da API, aplica o resultado no store e publica erros no bus.
 * Ex.: await run('plant', () => api.plant({ slotId, seedItemId, requestId: newRequestId() }))
 */
export async function run<T>(op: string, call: () => Promise<T>): Promise<T | null> {
  const { bus: b } = getServices();
  try {
    return await call();
  } catch (err) {
    const error = toApiError(err);
    b.emit('api:error', { error, op });
    return null;
  }
}

/** Heartbeat a cada 5 min e quando a aba volta a ficar visível. Retorna função para parar. */
export function startHeartbeat(s: Services): () => void {
  const beat = async () => {
    const r = await run('heartbeat', () => s.api.heartbeat());
    if (r) s.store.syncClock(r.farmClock, r.serverNow);
  };
  const timer = setInterval(beat, ECONOMY.HEARTBEAT_INTERVAL_MS);
  const onVis = () => {
    if (document.visibilityState === 'visible') void beat();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
}
