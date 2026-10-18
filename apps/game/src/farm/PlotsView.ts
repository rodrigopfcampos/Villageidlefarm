// Desenho dos canteiros: terra (raw/tilled/wet em nine-slice), planta por estágio (ou ícone de reserva),
// placa de preço quando bloqueado, brilho quando pronto, dica ao passar o mouse.

import Phaser from 'phaser';
import {
  formatDuration,
  type FarmClockSeconds,
  type LayoutPlot,
  type PlotState,
} from '@vif/shared';
import { NINE_SLICE } from '@vif/shared/generated/assetKeys';
import { DEPTH } from '../core/constants';
import { FX_DEPTH } from '../fx/depths';
import { FX_TEXTURES } from '../scenes/Preload';
import { entityDepth } from './buildings';
import { rectContains } from './geometry';
import {
  cropSpriteFor,
  fallbackIconScale,
  plantsInPlot,
  plotVisual,
  type PlotVisual,
} from './plotVisual';

const TILES = 'atlas_tiles';

interface PlotGfx {
  def: LayoutPlot;
  soil: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  plants: Phaser.GameObjects.Image[];
  sign: Phaser.GameObjects.Container | null;
  glow: Phaser.GameObjects.Image | null;
  sparkles: Phaser.GameObjects.Image[];
  highlight: Phaser.GameObjects.Rectangle;
  /** Assinatura do último desenho (evita refazer objetos todo segundo). */
  sig: string;
  visual: PlotVisual | null;
}

export class PlotsView {
  private readonly plots = new Map<string, PlotGfx>();
  private readonly tooltip: Phaser.GameObjects.Text;
  private hovered: string | null = null;
  private readonly has: (atlas: string, frame: string) => boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    defs: readonly LayoutPlot[],
    private readonly levelOf: () => number,
  ) {
    this.has = (atlas, frame) => scene.textures.exists(atlas) && scene.textures.get(atlas).has(frame);
    for (const def of defs) this.plots.set(def.slotId, this.createPlot(def));
    this.tooltip = scene.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#fffbe8',
        backgroundColor: '#2a1d10dd',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(FX_DEPTH.floating)
      .setVisible(false);
  }

  private createPlot(def: LayoutPlot): PlotGfx {
    const { x, y, width, height } = def.rect;
    const cx = x + width / 2;
    const cy = y + height / 2;
    let soil: PlotGfx['soil'];
    if (this.has(TILES, 'tile/soil_raw')) {
      const [l, r, t, b] = NINE_SLICE['tile/soil_raw'];
      soil = this.scene.add.nineslice(cx, cy, TILES, 'tile/soil_raw', width, height, l, r, t, b);
    } else {
      soil = this.scene.add.rectangle(cx, cy, width, height, 0x6b4a2b);
    }
    soil.setDepth(DEPTH.ground);
    const highlight = this.scene.add
      .rectangle(cx, cy, width + 4, height + 4)
      .setStrokeStyle(2, 0xfff2a8, 0.9)
      .setDepth(DEPTH.ground + 2)
      .setVisible(false);
    return { def, soil, plants: [], sign: null, glow: null, sparkles: [], highlight, sig: '', visual: null };
  }

  slotAt(x: number, y: number): string | null {
    for (const [id, p] of this.plots) {
      if (rectContains(p.def.rect, x, y)) return id;
      // a planta pronta passa da borda de cima: clicar nela também vale
      for (const img of p.plants) if (img.visible && img.getBounds().contains(x, y)) return id;
    }
    return null;
  }

  def(slotId: string): LayoutPlot | undefined {
    return this.plots.get(slotId)?.def;
  }

  visual(slotId: string): PlotVisual | null {
    return this.plots.get(slotId)?.visual ?? null;
  }

  setHover(slotId: string | null): void {
    if (this.hovered === slotId) return;
    if (this.hovered) this.plots.get(this.hovered)?.highlight.setVisible(false);
    this.hovered = slotId;
    if (slotId) this.plots.get(slotId)?.highlight.setVisible(true);
    this.updateTooltip();
  }

  /** Redesenha pelo estado do store e pelo relógio estimado. Barato se nada mudou. */
  refresh(get: (slotId: string) => PlotState | undefined, fc: FarmClockSeconds): void {
    for (const [id, p] of this.plots) {
      const v = plotVisual(get(id), fc);
      p.visual = v;
      const sig = `${v.kind}|${v.cropId}|${v.stage}|${v.kind === 'locked' ? this.levelOf() : ''}`;
      if (sig !== p.sig) {
        p.sig = sig;
        this.redraw(p, v);
      }
    }
    this.updateTooltip();
  }

  private setSoil(p: PlotGfx, frame: string): void {
    if (p.soil instanceof Phaser.GameObjects.NineSlice && this.has(TILES, frame)) {
      p.soil.setFrame(frame);
    }
  }

  private clear(p: PlotGfx): void {
    for (const img of p.plants) img.destroy();
    p.plants = [];
    p.sign?.destroy(true);
    p.sign = null;
    if (p.glow) this.scene.tweens.killTweensOf(p.glow);
    p.glow?.destroy();
    p.glow = null;
    for (const s of p.sparkles) {
      this.scene.tweens.killTweensOf(s);
      s.destroy();
    }
    p.sparkles = [];
  }

  private redraw(p: PlotGfx, v: PlotVisual): void {
    this.clear(p);
    this.setSoil(p, v.soil);
    const { x, y, width, height } = p.def.rect;
    const cx = x + width / 2;
    if (p.soil instanceof Phaser.GameObjects.NineSlice) {
      p.soil.setAlpha(v.kind === 'locked' ? 0.85 : 1);
    }
    if (v.kind === 'locked') {
      p.sign = this.makeSign(cx, y + height * 0.62, p.def);
      return;
    }
    if ((v.kind === 'growing' || v.kind === 'ready') && v.cropId && v.stage !== null) {
      const sprite = cropSpriteFor(v.cropId, v.stage, this.has);
      const n = plantsInPlot(width);
      // base da planta um pouco acima da borda de baixo do canteiro
      const baseY = y + height * (height < 100 ? 0.92 : 0.82);
      for (let i = 0; i < n; i++) {
        const px = x + (width * (i + 0.5)) / n;
        if (!sprite) {
          const dot = this.scene.add.image(px, baseY - 10, FX_TEXTURES.glow).setTint(0x5ca83a);
          dot.setScale(0.2 + v.stage * 0.08).setDepth(entityDepth(baseY));
          p.plants.push(dot);
          continue;
        }
        const img = this.scene.add.image(px, baseY, sprite.atlas, sprite.frame).setOrigin(0.5, 1);
        if (sprite.fallback) img.setScale(fallbackIconScale(v.stage)).setY(baseY - 6);
        else if (height < 100) img.setScale(0.85);
        img.setDepth(entityDepth(baseY));
        p.plants.push(img);
      }
      if (v.kind === 'ready') this.addReadyGlow(p, cx, baseY);
    }
  }

  private addReadyGlow(p: PlotGfx, cx: number, baseY: number): void {
    const { width, height } = p.def.rect;
    const glow = this.scene.add
      .image(cx, baseY - 30, FX_TEXTURES.glow)
      .setTint(0xfff1a0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(width * 1.1, height * 1.1)
      .setAlpha(0.25)
      .setDepth(entityDepth(baseY) + 0.2);
    this.scene.tweens.add({
      targets: glow,
      alpha: { from: 0.18, to: 0.5 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    p.glow = glow;
    for (let i = 0; i < 3; i++) {
      const s = this.scene.add
        .image(cx + (i - 1) * width * 0.28, baseY - 40 - i * 14, FX_TEXTURES.sparkle)
        .setDepth(entityDepth(baseY) + 0.3)
        .setScale(1.5)
        .setAlpha(0);
      this.scene.tweens.add({
        targets: s,
        alpha: { from: 0, to: 1 },
        y: s.y - 10,
        duration: 700,
        delay: i * 350,
        yoyo: true,
        repeat: -1,
        repeatDelay: 500,
      });
      p.sparkles.push(s);
    }
  }

  private makeSign(cx: number, baseY: number, def: LayoutPlot): Phaser.GameObjects.Container {
    const sign = this.scene.add.image(0, 0, FX_TEXTURES.sign).setOrigin(0.5, 1);
    const parts: Phaser.GameObjects.GameObject[] = [sign];
    const levelOk = this.levelOf() >= def.unlockLevel;
    const priceText = this.scene.add
      .text(6, -38, String(def.unlockCost), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#fff4d0',
        stroke: '#3a2210',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(2);
    parts.push(priceText);
    if (this.has('atlas_ui', 'ui/coin')) {
      const coin = this.scene.add.image(priceText.x - priceText.width / 2 - 9, -38, 'atlas_ui', 'ui/coin');
      coin.setScale(0.4);
      parts.push(coin);
    }
    if (!levelOk) {
      const lvl = this.scene.add
        .text(0, -62, `Nível ${def.unlockLevel}`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          color: '#ffe1e1',
          backgroundColor: '#5a1e1ecc',
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5)
        .setResolution(2);
      parts.push(lvl);
    }
    return this.scene.add.container(cx, baseY, parts).setDepth(entityDepth(baseY));
  }

  private updateTooltip(): void {
    const id = this.hovered;
    const p = id ? this.plots.get(id) : undefined;
    const v = p?.visual;
    if (!p || !v) {
      this.tooltip.setVisible(false);
      return;
    }
    let text = '';
    if (v.kind === 'locked') {
      text = this.levelOf() >= p.def.unlockLevel ? `Liberar: ${p.def.unlockCost} moedas` : `Nível ${p.def.unlockLevel} • ${p.def.unlockCost} moedas`;
    } else if (v.kind === 'empty') text = 'Plantar';
    else if (v.kind === 'ready') text = 'Pronto! Clique para colher';
    else text = `Falta ${formatDuration(v.remaining)}`;
    this.tooltip
      .setText(text)
      .setPosition(p.def.rect.x + p.def.rect.width / 2, p.def.rect.y - 4)
      .setVisible(true);
  }

  destroy(): void {
    for (const p of this.plots.values()) {
      this.clear(p);
      p.soil.destroy();
      p.highlight.destroy();
    }
    this.tooltip.destroy();
  }
}
