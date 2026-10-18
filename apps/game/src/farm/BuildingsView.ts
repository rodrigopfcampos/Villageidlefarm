// Prédios e árvores da camada "buildings": desenhados inteiros e ordenados pela base (y).
// A parte acima de overheadSplitY (telhado/copa) é um pedaço separado que fica semitransparente
// quando o jogador está escondido atrás dela. Sem o atlas de prédios, a FarmScene usa o overhead.png.

import Phaser from 'phaser';
import type { Rect } from '@vif/shared';
import { FRAME_ATLAS } from '@vif/shared/generated/assetKeys';
import {
  buildingBaseY,
  buildingDepth,
  isBehindOverhead,
  isGroundDecor,
  type BuildingDef,
} from './buildings';

interface BuildingGfx {
  def: BuildingDef;
  base: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.Image | null;
  alpha: number;
}

const SEE_THROUGH_ALPHA = 0.45;

export class BuildingsView {
  private readonly items: BuildingGfx[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    defs: readonly BuildingDef[],
  ) {
    for (const def of defs) {
      const g = this.create(def);
      if (g) this.items.push(g);
    }
  }

  get count(): number {
    return this.items.length;
  }

  private create(def: BuildingDef): BuildingGfx | null {
    const atlas = FRAME_ATLAS[def.sprite] ?? 'atlas_buildings';
    if (!this.scene.textures.exists(atlas) || !this.scene.textures.get(atlas).has(def.sprite)) {
      console.warn(`[farm] prédio "${def.name}": quadro ${def.sprite} não está no atlas`);
      return null;
    }
    const x = def.rect.x + def.rect.width / 2;
    const y = buildingBaseY(def);
    const depth = buildingDepth(def);
    const base = this.scene.add.image(x, y, atlas, def.sprite).setOrigin(0.5, 1).setDepth(depth);
    // Se o retângulo do Tiled foi redimensionado, acompanha.
    if (Math.abs(base.width - def.rect.width) > 1 || Math.abs(base.height - def.rect.height) > 1) {
      base.setDisplaySize(def.rect.width, def.rect.height);
    }
    if (isGroundDecor(def)) return { def, base, top: null, alpha: 1 };

    const scaleY = base.height > 0 ? def.rect.height / base.height : 1;
    const splitTex = Math.round(def.overheadSplitY / scaleY);
    base.setCrop(0, splitTex, base.width, base.height - splitTex);
    const top = this.scene.add
      .image(x, y, atlas, def.sprite)
      .setOrigin(0.5, 1)
      .setDisplaySize(base.displayWidth, base.displayHeight)
      .setCrop(0, 0, base.width, splitTex)
      .setDepth(depth + 0.1);
    return { def, base, top, alpha: 1 };
  }

  /** Telhados/copas semitransparentes quando o jogador está atrás deles. */
  update(body: Rect | null, feetY: number, dtMs: number): void {
    const k = Math.min(1, dtMs / 120);
    for (const g of this.items) {
      if (!g.top) continue;
      const target = body && isBehindOverhead(g.def, body, feetY) ? SEE_THROUGH_ALPHA : 1;
      if (Math.abs(g.alpha - target) < 0.01) {
        if (g.alpha !== target) {
          g.alpha = target;
          g.top.setAlpha(target);
        }
        continue;
      }
      g.alpha += (target - g.alpha) * k;
      g.top.setAlpha(g.alpha);
    }
  }

  destroy(): void {
    for (const g of this.items) {
      g.base.destroy();
      g.top?.destroy();
    }
    this.items.length = 0;
  }
}
