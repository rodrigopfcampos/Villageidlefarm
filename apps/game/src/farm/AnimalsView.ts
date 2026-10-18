// Animais: cada AnimalState do store vira um sprite que vagueia no cercado do seu habitat.
// Não há ciclo de caminhada na arte: trocamos entre as poses da raça e fazemos um pulinho ao andar.
// Balão com o ícone do produto quando há algo para coletar (previsão; o servidor decide).

import Phaser from 'phaser';
import {
  ANIMALS_BY_TYPE,
  ITEMS_BY_ID,
  type AnimalState,
  type FarmClockSeconds,
  type LayoutPen,
  type Point,
} from '@vif/shared';
import { ANIMAL_FRAMES } from '@vif/shared/generated/assetKeys';
import { FX_TEXTURES } from '../scenes/Preload';
import { breedsFor, hashString, penFor, pickBreed, randomPointIn, readyProducts, speciesOf } from './animals';
import { entityDepth } from './buildings';

const ATLAS = 'atlas_animals';

interface AnimalGfx {
  state: AnimalState;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Container | null;
  frames: string[];
  pen: LayoutPen | null;
  x: number;
  y: number;
  target: Point | null;
  waitUntil: number;
  hopT: number;
  speed: number;
  paused: boolean;
  ready: number;
  rnd: () => number;
}

/** Gerador pseudoaleatório pequeno (mulberry32) para não depender de Math.random no teste visual. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AnimalsView {
  private readonly animals = new Map<string, AnimalGfx>();
  private readonly frames: string[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly pens: readonly LayoutPen[],
  ) {
    const tex = scene.textures.exists(ATLAS) ? scene.textures.get(ATLAS) : null;
    this.frames = tex ? (ANIMAL_FRAMES as readonly string[]).filter((f) => tex.has(f)) : [];
  }

  /** Sincroniza com a lista do store (cria, atualiza, remove). */
  sync(list: Iterable<AnimalState>): void {
    const seen = new Set<string>();
    for (const a of list) {
      seen.add(a.id);
      const g = this.animals.get(a.id);
      if (g) g.state = { ...a };
      else this.create(a);
    }
    for (const [id, g] of this.animals) {
      if (seen.has(id)) continue;
      g.sprite.destroy();
      g.shadow.destroy();
      this.dropBubble(g);
      this.animals.delete(id);
    }
  }

  private create(a: AnimalState): void {
    const def = ANIMALS_BY_TYPE.get(a.animalType);
    const species = speciesOf(a.animalType);
    const breed = pickBreed(a.id, breedsFor(species, this.frames));
    const pen = penFor(def?.habitat, this.pens);
    const rnd = rng(hashString(a.id));
    const start = pen ? randomPointIn(pen.rect, 24, rnd) : { x: 100, y: 100 };
    const frames = breed?.frames ?? [];
    const first = frames[Math.floor(rnd() * frames.length)];
    const sprite = first
      ? this.scene.add.image(start.x, start.y, ATLAS, first)
      : this.scene.add.image(start.x, start.y, FX_TEXTURES.glow).setScale(0.4).setTint(0xffffff);
    sprite.setOrigin(0.5, 1).setFlipX(rnd() < 0.5);
    const big = (sprite.width || 32) > 60;
    const shadow = this.scene.add
      .image(start.x, start.y, FX_TEXTURES.shadow)
      .setOrigin(0.5, 0.6)
      .setScale(big ? 2 : 1, big ? 1.6 : 1);
    this.animals.set(a.id, {
      state: { ...a },
      sprite,
      shadow,
      bubble: null,
      frames,
      pen,
      x: start.x,
      y: start.y,
      target: null,
      waitUntil: this.scene.time.now + rnd() * 2500,
      hopT: 0,
      speed: big ? 26 : 34,
      paused: false,
      ready: 0,
      rnd,
    });
    this.place(this.animals.get(a.id)!);
  }

  private place(g: AnimalGfx, hop = 0): void {
    g.sprite.setPosition(Math.round(g.x), Math.round(g.y - hop));
    g.shadow.setPosition(Math.round(g.x), Math.round(g.y));
    const d = entityDepth(g.y);
    g.sprite.setDepth(d);
    g.shadow.setDepth(d - 0.5);
    if (g.bubble) g.bubble.setPosition(Math.round(g.x), Math.round(g.y - g.sprite.displayHeight - 4)).setDepth(d + 0.6);
  }

  /** Atualiza os balões pelo relógio estimado (chamar ~1x/s). */
  refreshProducts(fc: FarmClockSeconds): void {
    for (const g of this.animals.values()) {
      const n = readyProducts(g.state, ANIMALS_BY_TYPE.get(g.state.animalType), fc);
      if (n > 0 === g.ready > 0) {
        g.ready = n;
        continue;
      }
      g.ready = n;
      if (n > 0) g.bubble = this.makeBubble(g);
      else this.dropBubble(g);
      this.place(g);
    }
  }

  private dropBubble(g: AnimalGfx): void {
    if (!g.bubble) return;
    this.scene.tweens.killTweensOf(g.bubble.list);
    g.bubble.destroy(true);
    g.bubble = null;
  }

  private makeBubble(g: AnimalGfx): Phaser.GameObjects.Container {
    const def = ANIMALS_BY_TYPE.get(g.state.animalType);
    const icon = def ? ITEMS_BY_ID.get(def.productItemId)?.spriteKey : undefined;
    const parts: Phaser.GameObjects.GameObject[] = [
      this.scene.add.image(0, 0, FX_TEXTURES.bubble).setOrigin(0.5, 1),
    ];
    const tex = this.scene.textures.exists('atlas_icons') ? this.scene.textures.get('atlas_icons') : null;
    if (icon && tex?.has(icon)) parts.push(this.scene.add.image(0, -24, 'atlas_icons', icon).setScale(0.75));
    const c = this.scene.add.container(g.x, g.y, parts);
    this.scene.tweens.add({
      targets: parts,
      y: '-=4',
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return c;
  }

  animalAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestY = -Infinity;
    for (const [id, g] of this.animals) {
      const hit = g.sprite.getBounds().contains(x, y) || (g.bubble?.getBounds().contains(x, y) ?? false);
      if (hit && g.y > bestY) {
        best = id;
        bestY = g.y;
      }
    }
    return best;
  }

  position(id: string): Point | null {
    const g = this.animals.get(id);
    return g ? { x: g.x, y: g.y } : null;
  }

  hasProduct(id: string): boolean {
    return (this.animals.get(id)?.ready ?? 0) > 0;
  }

  setPaused(id: string, paused: boolean): void {
    const g = this.animals.get(id);
    if (!g) return;
    g.paused = paused;
    if (paused) {
      g.target = null;
      this.place(g);
    }
  }

  update(time: number, dtMs: number): void {
    for (const g of this.animals.values()) {
      if (g.paused || !g.pen) continue;
      if (!g.target) {
        if (time < g.waitUntil) continue;
        // às vezes só troca de pose; às vezes anda até um ponto próximo
        if (g.frames.length > 1 && g.rnd() < 0.45) {
          g.sprite.setFrame(g.frames[Math.floor(g.rnd() * g.frames.length)]!);
          g.waitUntil = time + 1500 + g.rnd() * 3500;
          continue;
        }
        const p = randomPointIn(g.pen.rect, 24, g.rnd);
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        const d = Math.hypot(dx, dy);
        const max = 90;
        g.target = d > max ? { x: g.x + (dx / d) * max, y: g.y + (dy / d) * max } : p;
        g.sprite.setFlipX(g.target.x < g.x);
        g.hopT = 0;
        continue;
      }
      const dx = g.target.x - g.x;
      const dy = g.target.y - g.y;
      const d = Math.hypot(dx, dy);
      const step = (g.speed * dtMs) / 1000;
      g.hopT += dtMs;
      if (d <= step) {
        g.x = g.target.x;
        g.y = g.target.y;
        g.target = null;
        g.waitUntil = time + 1200 + g.rnd() * 4000;
        if (g.frames.length > 1) g.sprite.setFrame(g.frames[Math.floor(g.rnd() * g.frames.length)]!);
        this.place(g);
        continue;
      }
      g.x += (dx / d) * step;
      g.y += (dy / d) * step;
      const hop = Math.abs(Math.sin((g.hopT / 260) * Math.PI)) * 3;
      this.place(g, hop);
    }
  }

  destroy(): void {
    this.sync([]);
  }
}
