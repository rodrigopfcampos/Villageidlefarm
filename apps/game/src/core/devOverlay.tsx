// Botões de desenvolvimento em DOM (Preact) por cima do canvas.
// Também serve de exemplo de como os painéis da Interface (A5) falam com o jogo: pelo bus.

import { render } from 'preact';
import { bus } from './bus';

function DevButtons() {
  return (
    <button
      type="button"
      onClick={() => bus.emit('debug:toggle-layout', {})}
      title="Mostrar/ocultar layout (tecla D)"
      style={{
        position: 'absolute',
        right: 'max(8px, env(safe-area-inset-right))',
        bottom: 'max(8px, env(safe-area-inset-bottom))',
        minWidth: 44,
        minHeight: 32,
        padding: '4px 8px',
        font: '12px monospace',
        color: '#fff',
        background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(255,255,255,0.4)',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      Layout (D)
    </button>
  );
}

export function mountDevOverlay(root: HTMLElement): void {
  const host = document.createElement('div');
  root.appendChild(host);
  render(<DevButtons />, host);
}
