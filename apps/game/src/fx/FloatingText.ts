// Textos flutuantes no mundo: +moedas, +XP, +itens, carta ganha, nível novo.

import type Phaser from 'phaser';
import { FX_DEPTH } from './depths';

export interface FloatEntry {
  text: string;
  color?: string;
  /** Ícone opcional [atlas, quadro]. */
  icon?: [string, string];
  big?: boolean;
}

export class FloatingText {
  constructor(private readonly scene: Phaser.Scene) {}

  private hasFrame(atlas: string, frame: string): boolean {
    return this.scene.textures.exists(atlas) && this.scene.textures.get(atlas).has(frame);
  }

  /** Mostra várias linhas empilhadas subindo a partir de (x, y). */
  show(x: number, y: number, entries: readonly FloatEntry[]): void {
    entries.forEach((e, i) =>
      this.scene.time.delayedCall(i * 160, () => this.one(x, y - i * 22, e)),
    );
  }

  private one(x: number, y: number, e: FloatEntry): void {
    const label = this.scene.add
      .text(0, 0, e.text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: e.big ? '22px' : '16px',
        fontStyle: 'bold',
        color: e.color ?? '#ffffff',
        stroke: '#1b130a',
        strokeThickness: 4,
      })
      .setOrigin(0, 0.5)
      .setResolution(2);
    const parts: Phaser.GameObjects.GameObject[] = [label];
    let width = label.width;
    if (e.icon && this.hasFrame(e.icon[0], e.icon[1])) {
      const icon = this.scene.add.image(0, 0, e.icon[0], e.icon[1]).setOrigin(0, 0.5);
      icon.setScale(Math.min(1, 22 / Math.max(icon.height, 1)));
      label.setX(icon.displayWidth + 3);
      width += icon.displayWidth + 3;
      parts.push(icon);
    }
    const c = this.scene.add.container(x - width / 2, y, parts).setDepth(FX_DEPTH.floating);
    c.setScale(0.6);
    this.scene.tweens.add({ targets: c, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: c,
      y: y - 46,
      alpha: { from: 1, to: 0 },
      delay: 650,
      duration: 900,
      ease: 'Sine.easeIn',
      onComplete: () => c.destroy(true),
    });
  }
}
