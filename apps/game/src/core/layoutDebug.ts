// Sobreposição de depuração do layout do Tiled (tecla D ou botão "Layout").
// colisão = vermelho, plots = verde (com slotId), pens = azul, locked_lots = amarelo,
// spawn = ponto branco, npc_points = ciano, overhead = laranja (contorno).

import type Phaser from 'phaser';
import type { FarmLayout, Shape } from '@vif/shared';
import { DEPTH } from './constants';

const COLORS = {
  grid: 0xffffff,
  collision: 0xff3b30,
  plots: 0x34c759,
  pens: 0x0a84ff,
  lockedLots: 0xffd60a,
  spawn: 0xffffff,
  npc: 0x64d2ff,
  overhead: 0xff9f0a,
} as const;

export class LayoutDebugOverlay {
  private readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, layout: FarmLayout) {
    const g = scene.add.graphics();
    const labels: Phaser.GameObjects.Text[] = [];
    const label = (x: number, y: number, text: string, color: number) => {
      const t = scene.add.text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#' + color.toString(16).padStart(6, '0'),
        backgroundColor: '#000000aa',
        padding: { x: 2, y: 1 },
      });
      t.setResolution(2);
      labels.push(t);
    };

    // grade de células
    g.lineStyle(1, COLORS.grid, 0.08);
    for (let x = 0; x <= layout.pixelWidth; x += layout.tileWidth) {
      g.lineBetween(x, 0, x, layout.pixelHeight);
    }
    for (let y = 0; y <= layout.pixelHeight; y += layout.tileHeight) {
      g.lineBetween(0, y, layout.pixelWidth, y);
    }

    const drawShape = (s: Shape, color: number, fillAlpha: number) => {
      g.fillStyle(color, fillAlpha);
      g.lineStyle(2, color, 0.9);
      if (s.kind === 'rect') {
        if (fillAlpha > 0) g.fillRect(s.x, s.y, s.width, s.height);
        g.strokeRect(s.x, s.y, s.width, s.height);
      } else {
        if (fillAlpha > 0) g.fillPoints(s.points, true);
        g.strokePoints(s.points, true);
      }
    };

    for (const s of layout.collision) drawShape(s, COLORS.collision, 0.3);
    for (const s of layout.overhead) drawShape(s, COLORS.overhead, 0);

    for (const p of layout.plots) {
      drawShape({ kind: 'rect', ...p.rect }, COLORS.plots, 0.25);
      const lock = p.startsUnlocked ? '' : ` [bloq $${p.unlockCost} nv${p.unlockLevel}]`;
      label(p.rect.x + 2, p.rect.y + 2, p.slotId + lock, COLORS.plots);
    }
    for (const pen of layout.pens) {
      drawShape({ kind: 'rect', ...pen.rect }, COLORS.pens, 0.2);
      label(pen.rect.x + 2, pen.rect.y + 2, `${pen.id} (${pen.habitat})`, COLORS.pens);
    }
    for (const lot of layout.lockedLots) {
      drawShape({ kind: 'rect', ...lot.rect }, COLORS.lockedLots, 0.2);
      label(lot.rect.x + 2, lot.rect.y + 2, `${lot.lotId} $${lot.cost}`, COLORS.lockedLots);
    }
    for (const n of layout.npcPoints) {
      g.fillStyle(COLORS.npc, 1);
      g.fillCircle(n.x, n.y, 6);
      label(n.x + 8, n.y - 8, n.npc, COLORS.npc);
    }
    g.fillStyle(0x000000, 1);
    g.fillCircle(layout.spawn.x, layout.spawn.y, 9);
    g.fillStyle(COLORS.spawn, 1);
    g.fillCircle(layout.spawn.x, layout.spawn.y, 6);
    label(layout.spawn.x + 10, layout.spawn.y - 8, 'spawn', COLORS.spawn);

    this.container = scene.add.container(0, 0, [g, ...labels]);
    this.container.setDepth(DEPTH.debug);
    this.container.setVisible(false);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
