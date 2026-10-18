// FarmScene inicial (Fundação). O agente Fazenda (A3) expande: jogador, canteiros, animais.
// Hoje: mapa + camada overhead + câmera (arrastar/zoom) + depuração do layout (tecla D).

import Phaser from 'phaser';
import { bus } from '../core/bus';
import { TEXTURE_KEYS } from '../core/assets';
import { CameraController } from '../core/cameraControls';
import { DEPTH, SCENE_KEYS, type FarmSceneData } from '../core/constants';
import { LayoutDebugOverlay } from '../core/layoutDebug';

export class FarmScene extends Phaser.Scene {
  cameraController: CameraController | null = null;
  layoutDebug: LayoutDebugOverlay | null = null;

  constructor() {
    super(SCENE_KEYS.farm);
  }

  create(data: FarmSceneData): void {
    const layout = data.layout;
    const mapInfo = data.loaded?.manifest.map;
    const hasMap = this.textures.exists(TEXTURE_KEYS.map);

    // Tamanho do mundo: manifest (se o mapa carregou) > layout > nada.
    let worldW = 0;
    let worldH = 0;
    if (hasMap) {
      const src = this.textures.get(TEXTURE_KEYS.map).getSourceImage();
      worldW = mapInfo?.width ?? src.width;
      worldH = mapInfo?.height ?? src.height;
      const img = this.add.image(0, 0, TEXTURE_KEYS.map).setOrigin(0).setDepth(DEPTH.map);
      if (src.width !== worldW || src.height !== worldH) {
        console.warn(
          `[farm] mapa ${src.width}x${src.height} difere do manifest ${worldW}x${worldH}`,
        );
        img.setDisplaySize(worldW, worldH);
      }
    } else if (layout) {
      worldW = layout.pixelWidth;
      worldH = layout.pixelHeight;
      this.add.rectangle(0, 0, worldW, worldH, 0x2d4a2d).setOrigin(0).setDepth(DEPTH.map);
    }

    if (worldW === 0 || worldH === 0) {
      this.showEmptyHint();
      return;
    }

    if (this.textures.exists(TEXTURE_KEYS.overhead)) {
      this.add.image(0, 0, TEXTURE_KEYS.overhead).setOrigin(0).setDepth(DEPTH.overhead);
    }

    this.cameraController = new CameraController(this, worldW, worldH);
    if (layout) this.cameraController.centerOn(layout.spawn.x, layout.spawn.y);

    if (layout) {
      this.layoutDebug = new LayoutDebugOverlay(this, layout);
      const toggle = (visible?: boolean) => {
        if (!this.layoutDebug) return;
        if (visible === undefined) this.layoutDebug.toggle();
        else this.layoutDebug.setVisible(visible);
      };
      this.input.keyboard?.on('keydown-D', () => bus.emit('debug:toggle-layout', {}));
      const off = bus.on('debug:toggle-layout', ({ visible }) => toggle(visible));
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    }
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
    const onResize = (size: Phaser.Structs.Size) =>
      text.setPosition(size.width / 2, size.height / 2);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize),
    );
  }
}
