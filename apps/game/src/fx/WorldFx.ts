// Efeitos visuais do mundo: iluminação dia/noite (MULTIPLY), lanterna do jogador à noite,
// vagalumes no evento noturno e chuva. Só visual; nada aqui decide valor.

import Phaser from 'phaser';
import type { WeatherKind } from '@vif/shared';
import { FX_TEXTURES } from '../scenes/Preload';
import { darkness, lightColor } from '../time/dayCycle';
import { FX_DEPTH } from './depths';

export class WorldFx {
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly lantern: Phaser.GameObjects.Image;
  private fireflies: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rain: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /** Retângulo da área visível (atualizado por quadro) usado como zona de emissão. */
  private readonly view = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private readonly rainZone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private color = -1;
  private weather: WeatherKind = 'clear';
  private night = false;
  private pendingFireflies = false;
  private frames = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    worldW: number,
    worldH: number,
  ) {
    // Cobre o mundo todo: a câmera nunca mostra fora do mapa, então cobre a tela também.
    this.tint = scene.add
      .rectangle(0, 0, worldW, worldH, 0xffffff)
      .setOrigin(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(FX_DEPTH.light)
      .setVisible(false);
    this.lantern = scene.add
      .image(0, 0, FX_TEXTURES.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffc070)
      .setDisplaySize(300, 220)
      .setDepth(FX_DEPTH.glow)
      .setVisible(false);
  }

  /** Aplica hora/clima/evento. Barato quando nada muda. */
  setState(hour: number, weather: WeatherKind, nightEvent: boolean): void {
    const c = lightColor(hour, weather);
    if (c !== this.color) {
      this.color = c;
      this.tint.setFillStyle(c).setVisible(c !== 0xffffff);
    }
    const dark = darkness(hour);
    this.lantern.setVisible(dark > 0.15).setAlpha(Math.min(0.55, dark * 0.6));
    if (weather !== this.weather) {
      this.weather = weather;
      this.setRain(weather === 'rain' || weather === 'storm');
    }
    if (nightEvent !== this.night) {
      this.night = nightEvent;
      // liga no próximo update(), quando a câmera já tem a área visível certa
      this.pendingFireflies = nightEvent;
      if (!nightEvent) this.setFireflies(false);
    }
  }

  private setFireflies(on: boolean): void {
    if (!on) {
      this.fireflies?.stop();
      return;
    }
    if (!this.fireflies) {
      this.fireflies = this.scene.add.particles(0, 0, FX_TEXTURES.glow, {
        emitZone: { type: 'random', source: this.view, quantity: 1 },
        lifespan: { min: 3500, max: 7000 },
        frequency: 70,
        quantity: 2,
        maxAliveParticles: 120,
        speedX: { min: -14, max: 14 },
        speedY: { min: -18, max: 8 },
        scale: { min: 0.12, max: 0.24 },
        tint: [0xfff59a, 0xd8ff8a, 0xffe07a],
        blendMode: Phaser.BlendModes.ADD,
        alpha: {
          onEmit: () => 0,
          onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) =>
            Math.sin(t * Math.PI) * (0.55 + 0.45 * Math.sin(t * 24 + p.x * 0.05)),
        },
      });
      this.fireflies.setDepth(FX_DEPTH.fireflies);
    }
    this.syncView();
    this.fireflies.start();
    this.fireflies.fastForward(5000, 50); // já começa cheio de vagalumes
  }

  private setRain(on: boolean): void {
    if (!on) {
      this.rain?.stop();
      return;
    }
    if (!this.rain) {
      this.rain = this.scene.add.particles(0, 0, FX_TEXTURES.rain, {
        emitZone: { type: 'random', source: this.rainZone, quantity: 1 },
        lifespan: 900,
        frequency: 12,
        quantity: 4,
        maxAliveParticles: 400,
        speedY: { min: 620, max: 760 },
        speedX: { min: -130, max: -90 },
        rotate: 10,
        scaleY: { min: 0.8, max: 1.4 },
        alpha: { start: 0.65, end: 0.25 },
      });
      this.rain.setDepth(FX_DEPTH.rain);
    }
    this.syncView();
    this.rain.start();
    this.rain.fastForward(900, 16);
  }

  /** Por quadro: acompanha a câmera e a lanterna. */
  update(playerX: number, playerY: number): void {
    this.syncView();
    this.frames++;
    if (this.pendingFireflies && this.frames > 3) {
      this.pendingFireflies = false;
      this.setFireflies(true);
    }
    if (this.lantern.visible) this.lantern.setPosition(playerX, playerY - 30);
  }

  private syncView(): void {
    const v = this.scene.cameras.main.worldView;
    this.view.setTo(v.x, v.y, v.width, v.height);
    // a chuva nasce acima e um pouco à direita da tela (vento para a esquerda)
    this.rainZone.setTo(v.x - 40, v.y - 160, v.width + 220, v.height * 0.6 + 160);
  }

  destroy(): void {
    this.tint.destroy();
    this.lantern.destroy();
    this.fireflies?.destroy();
    this.rain?.destroy();
  }
}
