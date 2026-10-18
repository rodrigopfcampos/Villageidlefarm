// Relógio visual do cliente: hora local pelo serverNow (store.estimatedServerNow()) no fuso do perfil,
// fase do dia, clima e evento noturno. Lê get_world_state a cada minuto (clima, fuso, evento).
// Emite no bus: time:phase, weather:changed, event:night-start, event:night-end.
// Só visual: nada aqui decide valor (o servidor mede a presença e acelera os canteiros).
//
// Depuração (visual apenas): ?hour=20.5 fixa a hora; ?weather=rain fixa o clima;
// no console: __vifTime.setHour(20) / __vifTime.setWeather('rain') / __vifTime.clear().

import type { DayPhase, EpochMs, WeatherKind, WorldState } from '@vif/shared';
import type { Services } from '../core/services';
import { hourOfDay, nightEventAt, phaseAt } from './dayCycle';

const WORLD_POLL_MS = 60_000;
const WEATHERS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow'];

export interface TimeSnapshot {
  hour: number;
  phase: DayPhase;
  weather: WeatherKind;
  nightEvent: boolean;
  /** Fim do evento (ms Unix, estimado) quando ativo. */
  nightEndsAt: EpochMs | null;
}

function parseParams(): { hour: number | null; weather: WeatherKind | null } {
  try {
    const q = new URLSearchParams(location.search);
    const h = q.get('hour');
    const w = q.get('weather') as WeatherKind | null;
    const hour = h !== null && h !== '' && Number.isFinite(Number(h)) ? Number(h) : null;
    return { hour, weather: w && WEATHERS.includes(w) ? w : null };
  } catch {
    return { hour: null, weather: null };
  }
}

export class TimeController {
  private world: WorldState | null = null;
  private forcedHour: number | null;
  private forcedWeather: WeatherKind | null;
  private last: TimeSnapshot | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly s: Services) {
    const p = parseParams();
    this.forcedHour = p.hour;
    this.forcedWeather = p.weather;
    (window as unknown as { __vifTime: unknown }).__vifTime = {
      setHour: (h: number | null) => (this.forcedHour = h),
      setWeather: (w: WeatherKind | null) => (this.forcedWeather = w),
      clear: () => {
        this.forcedHour = null;
        this.forcedWeather = null;
      },
      snapshot: () => this.snapshot(),
    };
  }

  start(): void {
    void this.pollWorld();
    this.pollTimer = setInterval(() => void this.pollWorld(), WORLD_POLL_MS);
    this.update();
  }

  private async pollWorld(): Promise<void> {
    try {
      const w = await this.s.api.getWorldState();
      if (this.disposed) return;
      this.world = w;
    } catch (err) {
      // Sem toast: o clima é só enfeite. O heartbeat/ações mostram erros de rede.
      console.warn('[time] get_world_state falhou', err);
    }
  }

  private timezone(): string {
    return this.world?.timezone ?? this.s.store.profile?.timezone ?? 'UTC';
  }

  /** Estado atual (calcula sem emitir). */
  snapshot(): TimeSnapshot {
    const now = this.s.store.estimatedServerNow();
    const tz = this.timezone();
    let hour: number;
    try {
      hour = this.forcedHour ?? hourOfDay(now, tz);
    } catch {
      hour = 12;
    }
    const weather = this.forcedWeather ?? this.world?.weather ?? 'clear';
    const nightEvent =
      this.forcedHour !== null
        ? nightEventAt(hour)
        : (this.world?.nightEvent.active ?? false) || nightEventAt(hour);
    let nightEndsAt: EpochMs | null = null;
    if (nightEvent) {
      nightEndsAt =
        this.forcedHour === null && this.world?.nightEvent.endsAt
          ? this.world.nightEvent.endsAt
          : now + Math.max(0, 21 - hour) * 3_600_000;
    }
    return { hour, phase: phaseAt(hour), weather, nightEvent, nightEndsAt };
  }

  /** Chame ~1x por segundo (ou a cada quadro): emite os eventos quando algo muda. */
  update(): TimeSnapshot {
    const snap = this.snapshot();
    const prev = this.last;
    const bus = this.s.bus;
    if (!prev || prev.phase !== snap.phase) {
      bus.emit('time:phase', { phase: snap.phase, localHour: Math.floor(snap.hour) });
    }
    if (!prev || prev.weather !== snap.weather)
      bus.emit('weather:changed', { weather: snap.weather });
    if (snap.nightEvent && (!prev || !prev.nightEvent)) {
      bus.emit('event:night-start', { endsAt: snap.nightEndsAt ?? 0 });
    } else if (!snap.nightEvent && prev?.nightEvent) {
      bus.emit('event:night-end', {});
    }
    this.last = snap;
    return snap;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
