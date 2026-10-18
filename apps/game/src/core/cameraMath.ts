// Matemática pura da câmera (testável sem Phaser).
// A câmera do Phaser dá zoom em volta do próprio centro:
//   worldX = scrollX + w/2 + (screenX - w/2) / zoom

export const MAX_ZOOM = 3;

/** Menor zoom que ainda cobre a tela inteira com o mapa (sem mostrar fora das bordas). */
export function minZoomToCover(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
): number {
  if (worldW <= 0 || worldH <= 0) return 1;
  return Math.max(viewW / worldW, viewH / worldH);
}

export function clampZoom(z: number, min: number, max = MAX_ZOOM): number {
  return Math.min(Math.max(z, min), Math.max(min, max));
}

/**
 * Novo scroll para que o ponto do mundo sob (screenX, screenY) continue no mesmo lugar
 * depois de trocar o zoom.
 */
export function scrollForZoomAt(
  scroll: { x: number; y: number },
  view: { w: number; h: number },
  screen: { x: number; y: number },
  oldZoom: number,
  newZoom: number,
): { x: number; y: number } {
  const hw = view.w / 2;
  const hh = view.h / 2;
  const worldX = scroll.x + hw + (screen.x - hw) / oldZoom;
  const worldY = scroll.y + hh + (screen.y - hh) / oldZoom;
  return {
    x: worldX - hw - (screen.x - hw) / newZoom,
    y: worldY - hh - (screen.y - hh) / newZoom,
  };
}

/** Fator de zoom da roda do mouse (deltaY positivo = afastar). */
export function wheelZoomFactor(deltaY: number): number {
  return Math.pow(1.0015, -deltaY);
}
