// Câmera: arrastar com mouse/dedo, zoom com roda e pinça, presa às bordas do mapa.
// `isDragging` permite que a cena ignore o "toque" que encerrou um arrasto.

import Phaser from 'phaser';
import {
  clampZoom,
  minZoomToCover,
  scrollForZoomAt,
  wheelZoomFactor,
  MAX_ZOOM,
} from './cameraMath';

const DRAG_THRESHOLD_PX = 6;

export class CameraController {
  private minZoom = 1;
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private pinchDist = 0;
  private readonly cam: Phaser.Cameras.Scene2D.Camera;

  constructor(
    private readonly scene: Phaser.Scene,
    private worldW: number,
    private worldH: number,
  ) {
    this.cam = scene.cameras.main;
    this.cam.setBounds(0, 0, worldW, worldH);
    scene.input.addPointer(1); // 2 dedos para a pinça

    this.updateMinZoom();
    this.cam.setZoom(clampZoom(Math.max(this.minZoom, 1), this.minZoom));
    this.cam.centerOn(worldW / 2, worldH / 2);

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** true durante um arrasto (e no pointerup que o encerra). */
  get isDragging(): boolean {
    return this.dragging;
  }

  centerOn(x: number, y: number): void {
    this.cam.centerOn(x, y);
  }

  setWorldSize(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
    this.cam.setBounds(0, 0, w, h);
    this.onResize();
  }

  private updateMinZoom(viewW = this.cam.width, viewH = this.cam.height): void {
    this.minZoom = minZoomToCover(viewW, viewH, this.worldW, this.worldH);
  }

  private zoomAt(screenX: number, screenY: number, target: number): void {
    const newZoom = clampZoom(target, this.minZoom, MAX_ZOOM);
    const old = this.cam.zoom;
    if (newZoom === old) return;
    const s = scrollForZoomAt(
      { x: this.cam.scrollX, y: this.cam.scrollY },
      { w: this.cam.width, h: this.cam.height },
      { x: screenX, y: screenY },
      old,
      newZoom,
    );
    this.cam.setZoom(newZoom);
    this.cam.setScroll(s.x, s.y);
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.scene.input.manager.pointers.filter((p) => p.isDown);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const down = this.activePointers();
    if (down.length >= 2) {
      const [a, b] = down as [Phaser.Input.Pointer, Phaser.Input.Pointer];
      this.pinchDist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      this.dragStart = null;
      this.dragging = true;
    } else {
      this.dragStart = { x: p.x, y: p.y };
      this.dragging = false;
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const down = this.activePointers();
    if (down.length >= 2) {
      const [a, b] = down as [Phaser.Input.Pointer, Phaser.Input.Pointer];
      const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (this.pinchDist > 0 && dist > 0) {
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.cam.zoom * (dist / this.pinchDist));
      }
      this.pinchDist = dist;
      return;
    }
    if (!p.isDown || !this.dragStart) return;
    if (!this.dragging) {
      const moved = Phaser.Math.Distance.Between(p.x, p.y, this.dragStart.x, this.dragStart.y);
      if (moved < DRAG_THRESHOLD_PX) return;
      this.dragging = true;
    }
    const dx = p.x - p.prevPosition.x;
    const dy = p.y - p.prevPosition.y;
    this.cam.setScroll(
      this.cam.scrollX - dx / this.cam.zoom,
      this.cam.scrollY - dy / this.cam.zoom,
    );
  }

  private onUp(): void {
    const down = this.activePointers();
    if (down.length === 1) {
      // saiu da pinça e ficou um dedo: recomeça o arrasto a partir dele
      const p = down[0]!;
      this.dragStart = { x: p.x, y: p.y };
      this.pinchDist = 0;
      return;
    }
    if (down.length === 0) {
      this.dragStart = null;
      this.pinchDist = 0;
      // Mantém `dragging` true até o próximo frame para a cena ignorar o "toque" final.
      if (this.dragging) this.scene.time.delayedCall(0, () => (this.dragging = false));
    }
  }

  private onWheel(p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    this.zoomAt(p.x, p.y, this.cam.zoom * wheelZoomFactor(dy));
  }

  private onResize(gameSize?: Phaser.Structs.Size): void {
    // Usa o tamanho novo do jogo: a câmera pode ainda não ter sido redimensionada.
    this.updateMinZoom(gameSize?.width, gameSize?.height);
    if (this.cam.zoom < this.minZoom) this.cam.setZoom(this.minZoom);
  }

  destroy(): void {
    const input = this.scene.input;
    input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }
}
