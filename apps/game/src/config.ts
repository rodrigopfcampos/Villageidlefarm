// Configuração do Phaser: pixel art nítido e escala RESIZE (o canvas ocupa a tela toda,
// em retrato ou paisagem; a câmera decide quanto do mapa aparece).

import Phaser from 'phaser';
import { BootScene } from './scenes/Boot';
import { FarmScene } from './scenes/FarmScene';

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1b2a1b',
    pixelArt: true,
    roundPixels: true,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      parent,
      width: '100%',
      height: '100%',
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    input: {
      activePointers: 3,
    },
    fps: { target: 60 },
    scene: [BootScene, FarmScene],
  };
}
