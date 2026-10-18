// Jogador: sprite do fazendeiro/fazendeira, andar (teclado ou caminho), ações animadas.

import type Phaser from 'phaser';
import type { Point, Rect } from '@vif/shared';
import {
  FX_TEXTURES,
  animKey,
  ensureCharacterAnims,
  type PlayerCharacter,
} from '../scenes/Preload';
import { facingFrom, resolveAnim, type CharAction, type Facing } from './animKeys';
import { entityDepth } from './buildings';
import { PLAYER_FOOT, slideMove, type Collider } from './pathfinding';

export const PLAYER_SPEED = 170; // px/s do mundo

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private character: PlayerCharacter;
  private available = new Set<string>();
  facing: Facing = 'down';
  private path: Point[] = [];
  private onArrive: ((arrived: boolean) => void) | null = null;
  private acting: { until: number; resolve: () => void } | null = null;
  private currentAnim = '';
  moving = false;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    character: PlayerCharacter,
    private readonly collider: Collider | null,
  ) {
    this.character = character;
    this.shadow = scene.add.image(x, y, FX_TEXTURES.shadow).setOrigin(0.5, 0.6).setScale(1.2, 1);
    this.sprite = scene.add.sprite(x, y, '__DEFAULT').setOrigin(0.5, 1);
    this.setCharacter(character);
    this.place(x, y);
  }

  /** Posição exata dos pés (o desenho é arredondado). */
  private px = 0;
  private py = 0;
  get x(): number {
    return this.px;
  }
  get y(): number {
    return this.py;
  }
  get characterKey(): PlayerCharacter {
    return this.character;
  }

  /** Corpo aproximado (para telhados semitransparentes). */
  body(): Rect {
    return { x: this.x - 18, y: this.y - 66, width: 36, height: 66 };
  }

  get busy(): boolean {
    return this.acting !== null || this.path.length > 0;
  }

  setCharacter(c: PlayerCharacter): void {
    this.character = c;
    this.available = ensureCharacterAnims(this.scene, c);
    this.currentAnim = '';
    if (this.available.size === 0) {
      // Sem atlas: um marcador simples para não sumir.
      this.sprite.setTexture(FX_TEXTURES.glow).setScale(0.5).setTint(0xffd27f);
      return;
    }
    this.sprite.clearTint().setScale(1);
    this.play(this.moving ? 'walk' : 'idle');
  }

  private play(action: CharAction, facing: Facing = this.facing): number {
    const r = resolveAnim(this.available, action, facing);
    if (!r) return 0;
    const key = animKey(this.character, r.key);
    this.sprite.setFlipX(r.flipX);
    if (this.currentAnim !== key) {
      this.currentAnim = key;
      this.sprite.play(key, true);
    }
    const anim = this.scene.anims.get(key);
    return anim ? (anim.frames.length / Math.max(1, anim.frameRate)) * 1000 : 0;
  }

  /** Para tudo (teclado assumiu o controle, ou cancelamento). */
  cancel(): void {
    this.path = [];
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.(false);
    if (this.acting) {
      const r = this.acting.resolve;
      this.acting = null;
      r();
    }
  }

  /** Segue um caminho (pontos dos pés). `done(true)` ao chegar; `done(false)` se cancelado. */
  walkPath(points: Point[], done?: (arrived: boolean) => void): void {
    this.cancel();
    this.path = [...points];
    this.onArrive = done ?? null;
    if (this.path.length === 0) this.finishPath();
  }

  private finishPath(): void {
    this.moving = false;
    this.play('idle');
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.(true);
  }

  /** Toca uma ação (regar/plantar/colher) por ~durationMs. Resolve ao terminar. */
  act(action: CharAction, facing: Facing, minMs = 700): Promise<void> {
    this.facing = facing;
    const animMs = this.play(action, facing);
    const ms = Math.max(minMs, Math.min(animMs, 1400));
    return new Promise((resolve) => {
      this.acting = { until: this.scene.time.now + ms, resolve };
    });
  }

  face(target: Point): void {
    this.facing = facingFrom(target.x - this.x, target.y - this.y, this.facing);
  }

  /** Movimento pelo teclado (dx, dy em -1..1). Cancela caminho/ação. */
  keyboardMove(dx: number, dy: number, dtMs: number): void {
    if (dx === 0 && dy === 0) return;
    if (this.busy) this.cancel();
    const len = Math.hypot(dx, dy) || 1;
    const step = (PLAYER_SPEED * dtMs) / 1000;
    const vx = (dx / len) * step;
    const vy = (dy / len) * step;
    const next = this.collider
      ? slideMove(this.collider, this.x, this.y, vx, vy, PLAYER_FOOT)
      : { x: this.x + vx, y: this.y + vy };
    this.facing = facingFrom(dx, dy, this.facing);
    this.setPos(next.x, next.y);
    this.moving = true;
    this.play('walk');
  }

  /** Teclado solto e sem caminho: volta ao idle. */
  stopIfKeyboard(): void {
    if (this.moving && this.path.length === 0 && !this.acting) {
      this.moving = false;
      this.play('idle');
    }
  }

  private setPos(x: number, y: number): void {
    this.px = x;
    this.py = y;
    this.sprite.setPosition(Math.round(x), Math.round(y));
    this.shadow.setPosition(this.sprite.x, this.sprite.y);
    const d = entityDepth(y);
    this.sprite.setDepth(d);
    this.shadow.setDepth(d - 0.5);
  }

  update(_time: number, dtMs: number): void {
    if (this.acting) {
      if (this.scene.time.now >= this.acting.until) {
        const r = this.acting.resolve;
        this.acting = null;
        this.play('idle');
        r();
      }
      return;
    }
    if (this.path.length > 0) {
      let budget = (PLAYER_SPEED * dtMs) / 1000;
      let x = this.x;
      let y = this.y;
      let dirX = 0;
      let dirY = 0;
      while (budget > 0 && this.path.length > 0) {
        const t = this.path[0]!;
        const dx = t.x - x;
        const dy = t.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          x = t.x;
          y = t.y;
          budget -= dist;
          this.path.shift();
        } else {
          x += (dx / dist) * budget;
          y += (dy / dist) * budget;
          budget = 0;
        }
        dirX = dx;
        dirY = dy;
      }
      this.facing = facingFrom(dirX, dirY, this.facing);
      this.setPos(x, y);
      this.moving = true;
      this.play('walk');
      if (this.path.length === 0) this.finishPath();
    }
  }

  /** Teleporta (início do jogo). */
  place(x: number, y: number): void {
    this.setPos(x, y);
  }
}
