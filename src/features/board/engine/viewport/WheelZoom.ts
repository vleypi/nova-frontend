import { Camera } from "@engine/core/Camera";
import { WHEEL_ZOOM_SENSITIVITY } from "@/features/board/constants/board.constant";

// Обработчик колеса мыши/трекпада: Ctrl или Cmd + wheel зумит,
// обычный wheel панорамирует камеру.
export class WheelZoom {
  private container: HTMLDivElement;
  private camera: Camera;
  private onPanRender: () => void;
  private onZoomRender: () => void;
  private boundOnWheel: (e: WheelEvent) => void;

  constructor(
    container: HTMLDivElement,
    camera: Camera,
    onPanRender: () => void,
    onZoomRender: () => void,
  ) {
    this.container = container;
    this.camera = camera;
    this.onPanRender = onPanRender;
    this.onZoomRender = onZoomRender;
    this.boundOnWheel = this.onWheel.bind(this);
  }

  // Подписывается на wheel-события. passive: false нужен для preventDefault.
  attach(): void {
    this.container.addEventListener("wheel", this.boundOnWheel, {
      passive: false,
    });
  }

  detach(): void {
    this.container.removeEventListener("wheel", this.boundOnWheel);
  }

  // С Ctrl/Cmd зумит экспоненциально вокруг курсора, иначе панит на дельту wheel.
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      this.camera.zoomBy(factor, mx, my);
      this.onZoomRender();
    } else {
      this.camera.pan(-e.deltaX, -e.deltaY);
      this.onPanRender();
    }
  }
}
