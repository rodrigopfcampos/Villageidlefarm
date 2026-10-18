// Event bus tipado. Os nomes e payloads vêm de @vif/shared (ClientEvents).
// Uso: bus.on('wallet:changed', (w) => ...); bus.emit('ui:toast', { kind: 'info', text: 'Oi' });

import type { ClientEventName, ClientEvents } from '@vif/shared';

export type Handler<K extends ClientEventName> = (payload: ClientEvents[K]) => void;

export class EventBus {
  private handlers = new Map<ClientEventName, Set<(payload: never) => void>>();

  /** Assina um evento. Retorna a função para cancelar. */
  on<K extends ClientEventName>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(name, handler);
  }

  once<K extends ClientEventName>(name: K, handler: Handler<K>): () => void {
    const off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends ClientEventName>(name: K, handler: Handler<K>): void {
    this.handlers.get(name)?.delete(handler as (payload: never) => void);
  }

  emit<K extends ClientEventName>(name: K, payload: ClientEvents[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    // Cópia: um handler pode se desinscrever durante o emit.
    for (const h of [...set]) {
      try {
        (h as Handler<K>)(payload);
      } catch (err) {
        console.error(`[bus] erro no handler de "${name}"`, err);
      }
    }
  }

  /** Remove todos os handlers (útil em testes e ao trocar de cena). */
  clear(): void {
    this.handlers.clear();
  }

  listenerCount(name: ClientEventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}

/** Instância global do jogo. */
export const bus = new EventBus();
