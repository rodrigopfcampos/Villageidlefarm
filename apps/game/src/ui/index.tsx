// Monta a interface DOM (Preact) dentro de #ui-root. Chamado uma vez pelo main.ts.
// Painéis falam com o jogo só pelo bus e pelo store (ver docs/ARCHITECTURE.md).

import { render } from 'preact';
import './styles/ui.css';
import { bus } from '../core/bus';
import { getServices } from '../core/services';
import { applyCssImages, loadUiAtlases, onAtlasChange } from './atlas';
import { App } from './App';

export function mountUi(root: HTMLElement): () => void {
  const host = document.createElement('div');
  host.className = 'vif-ui';
  // #ui-root > * recebe clique; a camada inteira não pode bloquear o canvas.
  host.style.pointerEvents = 'none';
  root.appendChild(host);

  const offAtlas = onAtlasChange(() => applyCssImages(document.documentElement));
  void loadUiAtlases();
  render(<App />, host);

  if (import.meta.env.DEV) {
    // Ajuda de depuração/screenshots: window.__ui.open('cards'), window.__ui.services()
    (window as unknown as { __ui: unknown }).__ui = {
      bus,
      services: () => getServices(),
      open: (panel: string, params?: Record<string, unknown>) =>
        bus.emit('ui:open-panel', { panel: panel as never, params }),
    };
  }

  return () => {
    offAtlas();
    render(null, host);
    host.remove();
  };
}
