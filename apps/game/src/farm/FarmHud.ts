// Camada de tela (zoom 1) da fazenda, numa cena separada por cima da FarmScene:
// selo do evento noturno (ícone ui/night_event + tempo restante) e a escolha do personagem.
// Os painéis de verdade (HUD, loja, cartas…) são DOM do agente Interface (A5).

import Phaser from 'phaser';
import {
  PLAYER_CHARACTERS,
  animKey,
  ensureCharacterAnims,
  type PlayerCharacter,
} from '../scenes/Preload';

export const FARM_HUD_KEY = 'FarmHud';

const LABELS: Record<PlayerCharacter, string> = { farmer_m: 'Fazendeiro', farmer_f: 'Fazendeira' };

export class FarmHud extends Phaser.Scene {
  private badge: Phaser.GameObjects.Container | null = null;
  private badgeText: Phaser.GameObjects.Text | null = null;
  private chooser: Phaser.GameObjects.Container | null = null;
  private ready = false;
  private pending: (() => void)[] = [];

  constructor() {
    super(FARM_HUD_KEY);
  }

  create(): void {
    const icon =
      this.textures.exists('atlas_ui') && this.textures.get('atlas_ui').has('ui/night_event')
        ? this.add.image(0, 0, 'atlas_ui', 'ui/night_event').setScale(0.8)
        : this.add.circle(0, 0, 18, 0x6a5acd);
    this.badgeText = this.add
      .text(26, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fff7d6',
      })
      .setOrigin(0, 0.5)
      .setResolution(2);
    const bg = this.add
      .rectangle(-28, 0, 10, 44, 0x1d1838, 0.78)
      .setOrigin(0, 0.5)
      .setStrokeStyle(2, 0xbfa8ff, 0.8);
    this.badge = this.add.container(0, 0, [bg, icon, this.badgeText]).setVisible(false);
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this),
    );
    this.ready = true;
    for (const fn of this.pending.splice(0)) fn();
  }

  /** Roda `fn` assim que a cena estiver criada (a cena é adicionada no meio de um quadro). */
  whenReady(fn: () => void): void {
    if (this.ready) fn();
    else this.pending.push(fn);
  }

  private layout(): void {
    const { width, height } = this.scale;
    if (this.badge) {
      const w = this.badgeWidth();
      this.badge.setPosition(Math.round(width / 2 - w / 2 + 28), 74);
    }
    if (this.chooser) this.chooser.setPosition(Math.round(width / 2), Math.round(height / 2));
  }

  private badgeWidth(): number {
    return 28 + 26 + (this.badgeText?.width ?? 0) + 14;
  }

  /** Mostra/esconde o selo do evento noturno. `text` ex.: "Evento noturno ×1.5 · 1:12:03". */
  setNightBadge(visible: boolean, text = ''): void {
    if (!this.badge || !this.badgeText) return;
    this.badge.setVisible(visible);
    if (!visible) return;
    if (this.badgeText.text !== text) {
      this.badgeText.setText(text);
      const bg = this.badge.list[0] as Phaser.GameObjects.Rectangle;
      bg.width = this.badgeWidth();
      this.layout();
    }
  }

  get choosing(): boolean {
    return this.chooser !== null;
  }

  /** Janela simples de escolha do personagem. */
  openChooser(current: PlayerCharacter | null, onPick: (c: PlayerCharacter) => void): void {
    this.chooser?.destroy(true);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const panel = this.add.rectangle(0, 0, 440, 270, 0x2a1d10, 0.92).setStrokeStyle(3, 0xd9a85b);
    const title = this.add
      .text(0, -108, 'Escolha seu personagem', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#fff4d0',
      })
      .setOrigin(0.5)
      .setResolution(2);
    parts.push(panel, title);
    PLAYER_CHARACTERS.forEach((c, i) => {
      const x = i === 0 ? -100 : 100;
      const card = this.add
        .rectangle(x, 10, 160, 170, current === c ? 0x5b4022 : 0x3d2b17)
        .setStrokeStyle(2, current === c ? 0xffe28a : 0x8a6a3a)
        .setInteractive({ useHandCursor: true });
      const anims = ensureCharacterAnims(this, c);
      const sprite = this.add.sprite(x, 50, '__DEFAULT').setOrigin(0.5, 1).setScale(1.6);
      if (anims.has('idle_down')) sprite.play(animKey(c, 'idle_down'));
      else sprite.setVisible(false);
      const label = this.add
        .text(x, 72, LABELS[c], {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          color: '#fff4d0',
        })
        .setOrigin(0.5)
        .setResolution(2);
      card.on('pointerover', () => card.setFillStyle(0x6b4c28));
      card.on('pointerout', () => card.setFillStyle(current === c ? 0x5b4022 : 0x3d2b17));
      card.on('pointerup', () => {
        this.closeChooser();
        onPick(c);
      });
      parts.push(card, sprite, label);
    });
    this.chooser = this.add.container(0, 0, parts).setDepth(10);
    this.layout();
  }

  closeChooser(): void {
    this.chooser?.destroy(true);
    this.chooser = null;
  }
}
