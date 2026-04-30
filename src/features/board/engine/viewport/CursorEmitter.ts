import { IInputObserver } from "@engine/input/InputRouter";
import { Camera } from "@engine/core/Camera";
import { CURSOR_THROTTLE_MS } from "@/features/board/constants/board.constant";

// Слушает движение курсора и эмитит позицию в мировых координатах с throttle.
// Используется для отправки позиции курсора другим пользователям через WebSocket,
// чтобы не спамить сетку каждым pointer-событием.
export class CursorEmitter implements IInputObserver {
  readonly name = "CursorEmitter";

  private container: HTMLDivElement;
  private camera: Camera;
  private emit: (wx: number, wy: number) => void;
  private throttleMs: number;
  private lastEmitAt = 0;

  constructor(
    container: HTMLDivElement,
    camera: Camera,
    emit: (wx: number, wy: number) => void,
    throttleMs = CURSOR_THROTTLE_MS,
  ) {
    this.container = container;
    this.camera = camera;
    this.emit = emit;
    this.throttleMs = throttleMs;
  }

  // Эмитит позицию курсора, если прошло достаточно времени с прошлой эмиссии.
  onMove(e: PointerEvent): void {
    const now = Date.now();
    if (now - this.lastEmitAt < this.throttleMs) return;
    this.lastEmitAt = now;
    const rect = this.container.getBoundingClientRect();
    const { wx, wy } = this.camera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    this.emit(wx, wy);
  }
}
