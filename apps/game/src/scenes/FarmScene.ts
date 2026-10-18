// FarmScene (agente Fazenda, A3): mapa, prédios/árvores com telhados, jogador, canteiros, animais,
// iluminação/clima/evento noturno e textos flutuantes. Fala com o resto só por store/api/bus.
//
// Controles: WASD/setas andam; clique anda (caminho na grade) ou age no canteiro/animal;
// roda do mouse = zoom; arrastar = mover a câmera (volta a seguir quando o jogador anda);
// C = trocar personagem; F3 ou Shift+D = sobreposição do layout (D sozinho é andar).

import Phaser from 'phaser';
import {
  ITEMS_BY_ID,
  formatDuration,
  resolveAssetUrl,
  type MutationResult,
  type PanelId,
  type Point,
  type ProgressState,
} from '@vif/shared';
import { FRAME_ATLAS } from '@vif/shared/generated/assetKeys';
import { bus } from '../core/bus';
import { TEXTURE_KEYS, loadJson } from '../core/assets';
import { CameraController } from '../core/cameraControls';
import { DEPTH, SCENE_KEYS, type FarmSceneData } from '../core/constants';
import { newRequestId } from '../core/ids';
import { LayoutDebugOverlay } from '../core/layoutDebug';
import { getServices, run, type Services } from '../core/services';
import { AnimalsView } from '../farm/AnimalsView';
import { BuildingsView } from '../farm/BuildingsView';
import { FARM_HUD_KEY, FarmHud } from '../farm/FarmHud';
import { Player } from '../farm/Player';
import { PlotsView } from '../farm/PlotsView';
import type { Facing } from '../farm/animKeys';
import { parseBuildings, entityDepth } from '../farm/buildings';
import { loadCharacter, saveCharacter } from '../farm/characterChoice';
import {
  PLAYER_FOOT,
  buildWalkGrid,
  cellCenter,
  cellOf,
  collidesAt,
  findPath,
  makeCollider,
  nearestFreeCell,
  type Collider,
  type WalkGrid,
} from '../farm/pathfinding';
import { FloatingText, type FloatEntry } from '../fx/FloatingText';
import { WorldFx } from '../fx/WorldFx';
import { FX_DEPTH } from '../fx/depths';
import { TimeController } from '../time/TimeController';
import { NPC_CHARACTERS, animKey, ensureCharacterAnims, prepareFarmAssets, type PlayerCharacter } from './Preload';

const GRID_CELL = 16;
const TICK_MS = 1000;

interface Job {
  key: string;
  run: () => Promise<void>;
}

interface StandPoint {
  point: Point;
  facing: Facing;
}

type WalkResult = 'arrived' | 'canceled' | 'unreachable';

export class FarmScene extends Phaser.Scene {
  cameraController: CameraController | null = null;
  layoutDebug: LayoutDebugOverlay | null = null;
  /** Serviços (store/api/bus/layout). Exposto para depuração: __game.scene.getScene('Farm').services */
  services: Services | null = null;

  private worldW = 0;
  private worldH = 0;
  private collider: Collider | null = null;
  private grid: WalkGrid | null = null;
  private player: Player | null = null;
  private plots: PlotsView | null = null;
  private animals: AnimalsView | null = null;
  private buildings: BuildingsView | null = null;
  private fx: WorldFx | null = null;
  private floating: FloatingText | null = null;
  private time_: TimeController | null = null;
  private hud: FarmHud | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private following = false;
  private tickAcc = 0;
  private queue: Job[] = [];
  private currentJob: string | null = null;
  private pumping = false;
  private readonly pending = new Set<string>();
  private lastActionAt: { x: number; y: number; t: number } | null = null;
  private offs: (() => void)[] = [];

  constructor() {
    super(SCENE_KEYS.farm);
  }

  create(data: FarmSceneData): void {
    const layout = data.layout;
    const mapInfo = data.loaded?.manifest.map;
    const hasMap = this.textures.exists(TEXTURE_KEYS.map);

    // Tamanho do mundo: manifest (se o mapa carregou) > layout > nada.
    if (hasMap) {
      const src = this.textures.get(TEXTURE_KEYS.map).getSourceImage();
      this.worldW = mapInfo?.width ?? src.width;
      this.worldH = mapInfo?.height ?? src.height;
      const img = this.add.image(0, 0, TEXTURE_KEYS.map).setOrigin(0).setDepth(DEPTH.map);
      if (src.width !== this.worldW || src.height !== this.worldH) {
        console.warn(`[farm] mapa ${src.width}x${src.height} difere do manifest ${this.worldW}x${this.worldH}`);
        img.setDisplaySize(this.worldW, this.worldH);
      }
    } else if (layout) {
      this.worldW = layout.pixelWidth;
      this.worldH = layout.pixelHeight;
      this.add.rectangle(0, 0, this.worldW, this.worldH, 0x2d4a2d).setOrigin(0).setDepth(DEPTH.map);
    }

    if (this.worldW === 0 || this.worldH === 0) {
      this.showEmptyHint();
      return;
    }

    prepareFarmAssets(this);
    try {
      this.services = getServices();
    } catch {
      this.services = null;
    }
    const store = this.services?.store;

    // Colisão e grade de caminhos
    if (layout) {
      this.collider = makeCollider(layout.collision, this.worldW, this.worldH);
      this.grid = buildWalkGrid(this.collider, GRID_CELL, PLAYER_FOOT);
    }

    // Prédios/árvores (camada "buildings" do .tmj, lida à parte) ou overhead.png de reserva
    void this.loadBuildings(data);

    // Canteiros e animais
    if (layout) {
      this.plots = new PlotsView(this, layout.plots, () => store?.progress.level ?? 1);
      this.animals = new AnimalsView(this, layout.pens);
      this.addNpcs(layout.npcPoints);
    }

    // Jogador
    const spawn = this.freeSpawn(layout?.spawn ?? { x: this.worldW / 2, y: this.worldH / 2 });
    const chosen = loadCharacter();
    this.player = new Player(this, spawn.x, spawn.y, chosen ?? 'farmer_m', this.collider);

    // Câmera: segue o jogador; zoom pela roda; arrastar solta o "seguir".
    this.cameraController = new CameraController(this, this.worldW, this.worldH);
    this.setDefaultZoom();
    this.cameras.main.centerOn(spawn.x, spawn.y - 30);
    this.follow();

    // Efeitos e tempo
    this.fx = new WorldFx(this, this.worldW, this.worldH);
    this.floating = new FloatingText(this);
    if (this.services) {
      this.time_ = new TimeController(this.services);
      this.time_.start();
    }

    // Camada de tela (selo do evento, escolha do personagem)
    if (this.scene.get(FARM_HUD_KEY)) this.scene.remove(FARM_HUD_KEY);
    this.hud = this.scene.add(FARM_HUD_KEY, FarmHud, true) as FarmHud;
    if (!chosen) this.hud.whenReady(() => this.openChooser());

    this.setupInput(layout !== null);
    this.subscribe();
    this.tick();

    (window as unknown as { __vifFarm: unknown }).__vifFarm = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  // ---------------- montagem ----------------

  private async loadBuildings(data: FarmSceneData): Promise<void> {
    const path = data.loaded?.manifest.map?.layout;
    let defs: ReturnType<typeof parseBuildings> = [];
    if (data.loaded && path) {
      const raw = await loadJson(resolveAssetUrl(data.loaded.baseDir, path));
      defs = parseBuildings(raw);
    }
    if (!this.sys.isActive()) return;
    this.buildings = new BuildingsView(this, defs);
    if (this.buildings.count === 0 && this.textures.exists(TEXTURE_KEYS.overhead)) {
      // Sem atlas de prédios: telhados prontos por cima de tudo (comportamento da Fundação).
      this.add.image(0, 0, TEXTURE_KEYS.overhead).setOrigin(0).setDepth(DEPTH.overhead);
    }
  }

  private addNpcs(points: readonly { npc: string; x: number; y: number }[]): void {
    for (const p of points) {
      if (!(NPC_CHARACTERS as readonly string[]).includes(p.npc)) continue;
      const anims = ensureCharacterAnims(this, p.npc);
      const key = anims.has('idle_down') ? 'idle_down' : [...anims][0];
      if (!key) continue;
      const s = this.add.sprite(p.x, p.y, '__DEFAULT').setOrigin(0.5, 1).setDepth(entityDepth(p.y));
      s.play({ key: animKey(p.npc, key), delay: Math.random() * 800 });
    }
  }

  private freeSpawn(p: Point): Point {
    if (!this.collider || !this.grid || !collidesAt(this.collider, p.x, p.y, PLAYER_FOOT)) return p;
    const c = cellOf(this.grid, p.x, p.y);
    const free = nearestFreeCell(this.grid, c.cx, c.cy);
    return free ? cellCenter(this.grid, free.cx, free.cy) : p;
  }

  private setDefaultZoom(): void {
    const cam = this.cameras.main;
    const min = Math.max(cam.width / this.worldW, cam.height / this.worldH);
    cam.setZoom(Math.max(min, Math.min(1.6, cam.height / 760)));
  }

  private follow(): void {
    if (this.following || !this.player) return;
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12, 0, 30);
    this.following = true;
  }

  private setupInput(hasLayout: boolean): void {
    const kb = this.input.keyboard;
    if (kb) {
      // enableCapture=false: não rouba as teclas dos campos de texto da interface DOM.
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
      kb.on('keydown-C', () => {
        if (!this.typingInDom()) this.openChooser();
      });
      if (hasLayout && this.services?.layout) {
        this.layoutDebug = new LayoutDebugOverlay(this, this.services.layout);
        const toggleKey = (e: KeyboardEvent) => {
          if (this.typingInDom()) return;
          if (e.key === 'F3' || (e.shiftKey && (e.key === 'D' || e.key === 'd'))) {
            e.preventDefault();
            bus.emit('debug:toggle-layout', {});
          }
        };
        kb.on('keydown', toggleKey);
        const off = bus.on('debug:toggle-layout', ({ visible }) => {
          if (!this.layoutDebug) return;
          if (visible === undefined) this.layoutDebug.toggle();
          else this.layoutDebug.setVisible(visible);
        });
        this.offs.push(off);
      }
    }
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
  }

  private subscribe(): void {
    if (!this.services) return;
    const { bus: b, store } = this.services;
    this.offs.push(
      b.on('farm:snapshot', () => {
        this.animals?.sync(store.animals.values());
        this.tick();
      }),
      b.on('plot:updated', (p) => {
        const before = this.plots?.visual(p.slotId)?.kind;
        this.plots?.refresh((id) => store.plot(id), store.estimatedFarmClock());
        const after = this.plots?.visual(p.slotId)?.kind;
        if (before === 'empty' && after === 'growing') this.enqueuePlantAnim(p.slotId);
      }),
      b.on('animal:updated', () => {
        this.animals?.sync(store.animals.values());
        this.animals?.refreshProducts(store.estimatedFarmClock());
      }),
      b.on('cards:changed', ({ dropped }) => {
        if (dropped.length === 0) return;
        const at = this.feedbackPoint();
        this.floating?.show(at.x, at.y - 40, [
          { text: dropped.length > 1 ? `${dropped.length} cartas!` : 'Carta ganha!', color: '#ffd76a', icon: ['atlas_cards', 'card/back'], big: true },
        ]);
      }),
      b.on('xp:changed', ({ leveledUp, level }) => {
        if (!leveledUp || !this.player) return;
        this.floating?.show(this.player.x, this.player.y - 100, [{ text: `Nível ${level}!`, color: '#9fe8ff', big: true }]);
      }),
    );
    this.animals?.sync(store.animals.values());
  }

  // ---------------- laço ----------------

  override update(time: number, delta: number): void {
    const p = this.player;
    if (!p) return;
    const dt = Math.min(delta, 100);

    // teclado
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (!this.typingInDom() && !this.hud?.choosing) {
      if (k.A?.isDown || k.LEFT?.isDown) dx -= 1;
      if (k.D?.isDown || k.RIGHT?.isDown) dx += 1;
      if (k.W?.isDown || k.UP?.isDown) dy -= 1;
      if (k.S?.isDown || k.DOWN?.isDown) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      if (this.queue.length > 0) this.queue = [];
      p.keyboardMove(dx, dy, dt);
      this.follow();
    } else {
      p.stopIfKeyboard();
    }
    p.update(time, dt);

    if (this.cameraController?.isDragging && this.following) {
      this.cameras.main.stopFollow();
      this.following = false;
    }

    this.animals?.update(time, dt);
    this.buildings?.update(p.body(), p.y, dt);
    this.fx?.update(p.x, p.y);

    this.tickAcc += delta;
    if (this.tickAcc >= TICK_MS) {
      this.tickAcc = 0;
      this.tick();
    }
  }

  /** ~1x/s: estágios das plantas, produtos dos animais, hora/clima/evento. */
  private tick(): void {
    const store = this.services?.store;
    if (store) {
      const fc = store.estimatedFarmClock();
      this.plots?.refresh((id) => store.plot(id), fc);
      this.animals?.refreshProducts(fc);
    }
    if (this.time_) {
      const t = this.time_.update();
      this.fx?.setState(t.hour, t.weather, t.nightEvent);
      if (t.nightEvent && store) {
        const left = t.nightEndsAt ? Math.max(0, (t.nightEndsAt - store.estimatedServerNow()) / 1000) : 0;
        this.hud?.setNightBadge(true, `Evento noturno  ×1.5  ·  ${formatDuration(left)}`);
      } else {
        this.hud?.setNightBadge(false);
      }
    }
  }

  // ---------------- entrada ----------------

  private typingInDom(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    if (!this.plots || ptr.isDown) return;
    const slot = this.plots.slotAt(ptr.worldX, ptr.worldY);
    const animal = this.animals?.animalAt(ptr.worldX, ptr.worldY) ?? null;
    this.plots.setHover(animal ? null : slot);
    this.input.manager.canvas.style.cursor = slot || animal ? 'pointer' : 'default';
  }

  private onPointerUp(ptr: Phaser.Input.Pointer): void {
    if (ptr.button !== 0 || this.cameraController?.isDragging || this.hud?.choosing) return;
    const wx = ptr.worldX;
    const wy = ptr.worldY;
    const animalId = this.animals?.animalAt(wx, wy) ?? null;
    if (animalId) {
      if (this.animals?.hasProduct(animalId)) this.enqueue({ key: `animal:${animalId}`, run: () => this.collectJob(animalId) });
      else this.enqueueWalk({ x: wx, y: wy + 30 });
      return;
    }
    const slot = this.plots?.slotAt(wx, wy) ?? null;
    if (slot) {
      this.onPlotClick(slot);
      return;
    }
    this.enqueueWalk({ x: wx, y: wy });
  }

  private onPlotClick(slotId: string): void {
    const v = this.plots?.visual(slotId);
    if (!v) return;
    switch (v.kind) {
      case 'locked':
        this.openPanel('unlock', { slotId });
        break;
      case 'empty':
        this.openPanel('plant', { slotId });
        this.enqueue({ key: `goto:${slotId}`, run: () => this.gotoPlotJob(slotId) });
        break;
      case 'ready':
        this.enqueue({ key: `harvest:${slotId}`, run: () => this.harvestJob(slotId) });
        break;
      case 'growing':
        this.enqueue({ key: `water:${slotId}`, run: () => this.waterJob(slotId) });
        break;
    }
  }

  /**
   * PEDIDO DE CONTRATO: PanelId ainda não tem 'plant' nem 'unlock'. O slotId vai em params.
   */
  private openPanel(panel: 'plant' | 'unlock', params: Record<string, unknown>): void {
    bus.emit('ui:open-panel', { panel: panel as unknown as PanelId, params });
  }

  private openChooser(): void {
    if (!this.hud || !this.player) return;
    const player = this.player;
    this.hud.whenReady(() =>
      this.hud?.openChooser(loadCharacter(), (c: PlayerCharacter) => {
        saveCharacter(c);
        player.setCharacter(c);
      }),
    );
  }

  // ---------------- fila de ações ----------------

  private enqueue(job: Job): void {
    if (this.currentJob === job.key || this.queue.some((j) => j.key === job.key)) return;
    if (this.queue.length >= 24) return;
    this.queue.push(job);
    void this.pump();
  }

  /** Andar até um ponto substitui andanças pendentes. */
  private enqueueWalk(target: Point): void {
    this.queue = this.queue.filter((j) => !j.key.startsWith('walk'));
    if (this.currentJob?.startsWith('walk') || this.currentJob?.startsWith('goto')) this.player?.cancel();
    this.showClickMarker(target);
    this.enqueue({ key: `walk:${target.x},${target.y}`, run: async () => void (await this.walkTo(target)) });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.currentJob = job.key;
        try {
          await job.run();
        } catch (err) {
          console.error('[farm] ação falhou', err);
        }
      }
    } finally {
      this.currentJob = null;
      this.pumping = false;
    }
  }

  private walkTo(target: Point): Promise<WalkResult> {
    const p = this.player;
    if (!p) return Promise.resolve('unreachable');
    this.follow();
    if (!this.grid || !this.collider) {
      return new Promise((res) => p.walkPath([target], (ok) => res(ok ? 'arrived' : 'canceled')));
    }
    const collider = this.collider;
    const path = findPath(this.grid, { x: p.x, y: p.y }, target, (q) => !collidesAt(collider, q.x, q.y, PLAYER_FOOT));
    if (!path) return Promise.resolve('unreachable');
    return new Promise((res) => p.walkPath(path, (ok) => res(ok ? 'arrived' : 'canceled')));
  }

  /** Onde ficar para mexer num retângulo (canteiro): ao lado, de frente para ele. */
  private standPointFor(r: { x: number; y: number; width: number; height: number }): StandPoint {
    const p = this.player;
    const yMid = r.y + r.height * 0.72;
    const cx = r.x + r.width / 2;
    const options: StandPoint[] = [
      { point: { x: r.x - 14, y: yMid }, facing: 'right' },
      { point: { x: r.x + r.width + 14, y: yMid }, facing: 'left' },
      { point: { x: cx, y: r.y + r.height + 16 }, facing: 'up' },
      { point: { x: cx, y: r.y - 4 }, facing: 'down' },
    ];
    const free = options.filter((o) => !this.collider || !collidesAt(this.collider, o.point.x, o.point.y, PLAYER_FOOT));
    const list = free.length > 0 ? free : options;
    if (!p) return list[0]!;
    return list.reduce((a, b) =>
      Math.hypot(a.point.x - p.x, a.point.y - p.y) <= Math.hypot(b.point.x - p.x, b.point.y - p.y) ? a : b,
    );
  }

  private async gotoPlotJob(slotId: string): Promise<void> {
    const def = this.plots?.def(slotId);
    if (!def || !this.player) return;
    const stand = this.standPointFor(def.rect);
    if ((await this.walkTo(stand.point)) === 'arrived') this.player.facing = stand.facing;
  }

  private enqueuePlantAnim(slotId: string): void {
    if (this.queue.length > 3) return;
    this.enqueue({
      key: `plant:${slotId}`,
      run: async () => {
        const def = this.plots?.def(slotId);
        const p = this.player;
        if (!def || !p) return;
        const stand = this.standPointFor(def.rect);
        if ((await this.walkTo(stand.point)) === 'canceled') return;
        await p.act('plant', stand.facing, 900);
      },
    });
  }

  private async waterJob(slotId: string): Promise<void> {
    const def = this.plots?.def(slotId);
    const p = this.player;
    if (!def || !p) return;
    const stand = this.standPointFor(def.rect);
    if ((await this.walkTo(stand.point)) === 'canceled') return;
    await p.act('water', stand.facing, 1100);
    const v = this.plots?.visual(slotId);
    if (v?.kind === 'growing') {
      this.floating?.show(def.rect.x + def.rect.width / 2, def.rect.y + 10, [
        { text: `Falta ${formatDuration(v.remaining)}`, color: '#cfe9ff' },
      ]);
    }
  }

  private async harvestJob(slotId: string): Promise<void> {
    const s = this.services;
    const def = this.plots?.def(slotId);
    const p = this.player;
    if (!s || !def || !p || this.pending.has(slotId)) return;
    this.pending.add(slotId);
    try {
      const stand = this.standPointFor(def.rect);
      if ((await this.walkTo(stand.point)) === 'canceled') return;
      if (this.plots?.visual(slotId)?.kind !== 'ready') return;
      const before = this.snapshot();
      const [result] = await Promise.all([
        run('harvest', () => s.api.harvest({ slotId, requestId: newRequestId() })),
        p.act('harvest', stand.facing, 800),
      ]);
      if (!result) return;
      const at = { x: def.rect.x + def.rect.width / 2, y: def.rect.y + 10 };
      this.lastActionAt = { ...at, t: this.time.now };
      s.store.apply(result);
      this.showGains(result, before, at);
    } finally {
      this.pending.delete(slotId);
    }
  }

  private async collectJob(animalId: string): Promise<void> {
    const s = this.services;
    const p = this.player;
    const pos = this.animals?.position(animalId);
    if (!s || !p || !pos || this.pending.has(animalId)) return;
    this.pending.add(animalId);
    this.animals?.setPaused(animalId, true);
    try {
      const side = p.x < pos.x ? -1 : 1;
      const candidates = [
        { x: pos.x + side * 38, y: pos.y + 2 },
        { x: pos.x - side * 38, y: pos.y + 2 },
      ];
      const target =
        candidates.find((c) => !this.collider || !collidesAt(this.collider, c.x, c.y, PLAYER_FOOT)) ?? candidates[0]!;
      if ((await this.walkTo(target)) === 'canceled') return;
      const facing: Facing = p.x < pos.x ? 'right' : 'left';
      const before = this.snapshot();
      const [result] = await Promise.all([
        run('collectAnimal', () => s.api.collectAnimal({ animalId, requestId: newRequestId() })),
        p.act('harvest', facing, 700),
      ]);
      if (!result) return;
      const at = { x: pos.x, y: pos.y - 60 };
      this.lastActionAt = { ...at, t: this.time.now };
      s.store.apply(result);
      this.showGains(result, before, at);
    } finally {
      this.pending.delete(animalId);
      this.animals?.setPaused(animalId, false);
    }
  }

  // ---------------- feedback ----------------

  private snapshot(): { coins: number; progress: ProgressState } {
    const st = this.services!.store;
    return { coins: st.wallet.coins, progress: { ...st.progress } };
  }

  private feedbackPoint(): Point {
    if (this.lastActionAt && this.time.now - this.lastActionAt.t < 2500) return this.lastActionAt;
    return { x: this.player?.x ?? 0, y: (this.player?.y ?? 0) - 70 };
  }

  private showGains(r: MutationResult, before: { coins: number; progress: ProgressState }, at: Point): void {
    const entries: FloatEntry[] = [];
    for (const g of r.gained ?? []) {
      if (g.qty <= 0 || g.itemId.startsWith('card_')) continue;
      const frame = ITEMS_BY_ID.get(g.itemId)?.spriteKey;
      entries.push({
        text: `+${g.qty}`,
        icon: frame ? [FRAME_ATLAS[frame] ?? 'atlas_icons', frame] : undefined,
      });
    }
    const coins = r.wallet ? r.wallet.coins - before.coins : 0;
    if (coins > 0) entries.push({ text: `+${coins}`, color: '#ffe066', icon: ['atlas_ui', 'ui/coin'] });
    const xp = r.xp ? r.xp.xp - before.progress.xp : 0;
    if (xp > 0) entries.push({ text: `+${xp} XP`, color: '#b4f28a', icon: ['atlas_ui', 'ui/xp_star'] });
    if (entries.length > 0) this.floating?.show(at.x, at.y, entries);
  }

  private showClickMarker(p: Point): void {
    const ring = this.add
      .ellipse(p.x, p.y, 26, 12)
      .setStrokeStyle(2, 0xfff2a8, 0.9)
      .setDepth(DEPTH.ground + 3);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.4, to: 1.2 },
      alpha: { from: 1, to: 0 },
      duration: 450,
      onComplete: () => ring.destroy(),
    });
  }

  // ---------------- limpeza ----------------

  private cleanup(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.time_?.dispose();
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    if (this.scene.get(FARM_HUD_KEY)) this.scene.remove(FARM_HUD_KEY);
  }

  private showEmptyHint(): void {
    const { width, height } = this.scale;
    const text = this.add
      .text(
        width / 2,
        height / 2,
        'Sem mapa ainda: assets/manifest.json ou o mapa não foram encontrados (veja o console).',
        {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          color: '#9fb59f',
          align: 'center',
          wordWrap: { width: Math.max(200, width - 32) },
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0);
    const onResize = (size: Phaser.Structs.Size) => text.setPosition(size.width / 2, size.height / 2);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
  }
}

export { FX_DEPTH };
