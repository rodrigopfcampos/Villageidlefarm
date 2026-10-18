// Preparação da fazenda (chamada pela FarmScene depois que o Boot carregou os atlas):
// texturas geradas (brilho, gota de chuva, sombra, placa, balão) e animações dos personagens.
// Tudo opcional: se faltar um atlas, a função só pula o que dependia dele.

import type Phaser from 'phaser';
import { CHARACTER_FRAMES } from '@vif/shared/generated/assetKeys';
import { collectAnimFrames } from '../farm/animKeys';

export const FX_TEXTURES = {
  glow: 'fx_glow',
  dot: 'fx_dot',
  rain: 'fx_rain',
  shadow: 'fx_shadow',
  sign: 'fx_sign',
  bubble: 'fx_bubble',
  sparkle: 'fx_sparkle',
} as const;

export const CHARACTER_ATLAS = 'atlas_characters';
export const PLAYER_CHARACTERS = ['farmer_m', 'farmer_f'] as const;
export type PlayerCharacter = (typeof PLAYER_CHARACTERS)[number];
export const NPC_CHARACTERS = ['shopkeeper', 'blacksmith', 'scientist', 'elder'] as const;

/** Frame rate por ação. */
const FPS: Record<string, number> = { idle: 2, walk: 8, water: 6, plant: 6, harvest: 5, hoe: 5 };

function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

function makeTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, FX_TEXTURES.glow, 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  canvasTexture(scene, FX_TEXTURES.dot, 8, 8, (ctx) => {
    const g = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 8);
  });
  canvasTexture(scene, FX_TEXTURES.rain, 2, 18, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 18);
    g.addColorStop(0, 'rgba(200,220,255,0)');
    g.addColorStop(1, 'rgba(220,235,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 18);
  });
  canvasTexture(scene, FX_TEXTURES.shadow, 32, 12, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(16, 6, 15, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(16, 6, 10, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, FX_TEXTURES.sparkle, 9, 9, (ctx) => {
    ctx.fillStyle = '#fffbe0';
    ctx.fillRect(4, 0, 1, 9);
    ctx.fillRect(0, 4, 9, 1);
    ctx.fillRect(3, 3, 3, 3);
  });
  // Placa de madeira (bloqueado): tábua 60x30 num poste.
  canvasTexture(scene, FX_TEXTURES.sign, 64, 52, (ctx) => {
    ctx.fillStyle = '#4a2e18';
    ctx.fillRect(29, 26, 6, 26);
    ctx.fillStyle = '#3a2210';
    ctx.fillRect(2, 2, 60, 30);
    ctx.fillStyle = '#9a6234';
    ctx.fillRect(4, 4, 56, 26);
    ctx.fillStyle = '#b57a44';
    ctx.fillRect(4, 4, 56, 3);
    ctx.fillRect(4, 16, 56, 2);
    ctx.fillStyle = '#7a4a24';
    ctx.fillRect(4, 27, 56, 3);
    ctx.fillStyle = '#2a180a';
    ctx.fillRect(7, 7, 2, 2);
    ctx.fillRect(55, 7, 2, 2);
  });
  // Balão do produto pronto (animal).
  canvasTexture(scene, FX_TEXTURES.bubble, 36, 40, (ctx) => {
    ctx.fillStyle = '#f3d9a4';
    ctx.beginPath();
    ctx.roundRect(1, 1, 34, 30, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, 30);
    ctx.lineTo(18, 39);
    ctx.lineTo(24, 30);
    ctx.fill();
    ctx.fillStyle = '#4a3220';
    ctx.beginPath();
    ctx.roundRect(3, 3, 30, 26, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, 28);
    ctx.lineTo(18, 35);
    ctx.lineTo(22, 28);
    ctx.fill();
  });
}

/** Chave da animação no Phaser: "<personagem>:<ação>_<dir>". */
export function animKey(character: string, actionDir: string): string {
  return `${character}:${actionDir}`;
}

/** Cria as animações de um personagem; devolve as "<ação>_<dir>" disponíveis. */
export function ensureCharacterAnims(scene: Phaser.Scene, character: string): Set<string> {
  const available = new Set<string>();
  if (!scene.textures.exists(CHARACTER_ATLAS)) return available;
  const tex = scene.textures.get(CHARACTER_ATLAS);
  const frames = (CHARACTER_FRAMES as readonly string[]).filter((f) => tex.has(f));
  for (const [actionDir, list] of collectAnimFrames(frames, character)) {
    available.add(actionDir);
    const key = animKey(character, actionDir);
    if (scene.anims.exists(key)) continue;
    const action = actionDir.split('_')[0] ?? 'idle';
    const loop = action === 'idle' || action === 'walk' || action === 'water';
    scene.anims.create({
      key,
      frames: list.map((frame) => ({ key: CHARACTER_ATLAS, frame })),
      frameRate: FPS[action] ?? 6,
      repeat: loop ? -1 : 0,
    });
  }
  return available;
}

export function prepareFarmAssets(scene: Phaser.Scene): void {
  makeTextures(scene);
  for (const c of [...PLAYER_CHARACTERS, ...NPC_CHARACTERS]) ensureCharacterAnims(scene, c);
}
