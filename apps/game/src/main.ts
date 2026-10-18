// Ponto de entrada do jogo: cria o Phaser e monta a camada de interface DOM (Preact).

import Phaser from 'phaser';
import { createGameConfig } from './config';
import { mountDevOverlay } from './core/devOverlay';

const parent = document.getElementById('game');
const uiRoot = document.getElementById('ui-root');
if (!parent || !uiRoot) throw new Error('index.html precisa de #game e #ui-root');

const game = new Phaser.Game(createGameConfig(parent));
mountDevOverlay(uiRoot);

// Acesso pelo console do navegador para depuração: window.__game
(window as unknown as { __game: Phaser.Game }).__game = game;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy(true);
    uiRoot.replaceChildren();
  });
}
