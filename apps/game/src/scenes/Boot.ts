// Boot: lê o manifest, carrega o que existir (mapa, overhead, atlas), lê o layout,
// cria os serviços (bus/store/api), faz o bootstrap e abre a FarmScene.
// Nada aqui pode quebrar se faltar arquivo: tudo vira aviso no console.

import Phaser from 'phaser';
import { resolveAssetUrl, type FarmLayout } from '@vif/shared';
import {
  loadJson,
  loadLayout,
  loadManifest,
  planLoads,
  type LoadItem,
  type LoadedManifest,
} from '../core/assets';
import { SCENE_KEYS, manifestUrl, type FarmSceneData } from '../core/constants';
import { createServices, run, startHeartbeat } from '../core/services';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.boot);
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, 'Carregando…', { fontFamily: 'sans-serif', fontSize: '18px' })
      .setOrigin(0.5);
    void this.boot();
  }

  private async boot(): Promise<void> {
    const loaded = await loadManifest(manifestUrl());
    if (loaded) await this.loadAssets(planLoads(loaded));
    const layout = await this.loadLayoutFrom(loaded);

    const services = createServices(layout);
    const snapshot = await run('bootstrap', () => services.api.bootstrap());
    if (snapshot) services.store.applyBootstrap(snapshot);
    services.store.startTicking();
    startHeartbeat(services);

    const data: FarmSceneData = { loaded, layout };
    this.scene.start(SCENE_KEYS.farm, data);
  }

  private async loadLayoutFrom(loaded: LoadedManifest | null): Promise<FarmLayout | null> {
    const path = loaded?.manifest.map?.layout;
    if (!loaded || !path) return null;
    const result = await loadLayout(resolveAssetUrl(loaded.baseDir, path));
    return result?.layout ?? null;
  }

  /** Enfileira tudo no loader do Phaser e espera terminar (com ou sem erros). */
  private async loadAssets(items: LoadItem[]): Promise<void> {
    for (const item of items) {
      if (item.type === 'image') {
        this.load.image(item.key, item.url);
      } else {
        // O JSON do atlas é lido antes: se faltar ou vier quebrado, pulamos o atlas sem exceção.
        const json = await loadJson(item.json);
        const frames = (json as { frames?: unknown } | null)?.frames;
        if (!json || typeof frames !== 'object' || frames === null || Array.isArray(frames)) {
          console.warn(`[assets] atlas "${item.key}": ${item.json} ausente ou não é JSON Hash`);
          continue;
        }
        this.load.atlas(item.key, item.png, json as object);
      }
    }
    if (this.load.list.size === 0) return;

    await new Promise<void>((resolve) => {
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
        console.warn(`[assets] falhou: ${file.key} (${String(file.url)})`);
      });
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });

    for (const item of items) {
      if (!this.textures.exists(item.key)) console.warn(`[assets] "${item.key}" não carregou`);
    }
  }
}
