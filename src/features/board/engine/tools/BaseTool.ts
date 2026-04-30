import { IElement, THistoryEntry, TTool } from "@engine/types";
import { Camera } from "@engine/core/Camera";
import { ElementStore } from "@engine/core/ElementStore";
import { SelectionManager } from "@engine/selection/SelectionManager";
import { BoardRenderer } from "@engine/renderer/BoardRenderer";

// Зависимости, которые BoardEngine прокидывает каждому инструменту.
export interface IToolDeps {
  container: HTMLDivElement;
  camera: Camera;
  store: ElementStore;
  selection: SelectionManager;
  renderer: BoardRenderer;
  boardId: string;
  pushHistory: (entry: THistoryEntry) => void;
  getActiveTool: () => string;
  openEdit: (element: IElement) => void;
  setActiveTool: (tool: TTool) => void;
}

// Базовый класс всех инструментов доски (Pencil, Eraser, Select, Text, Sticky).
// Хранит общие зависимости и предоставляет утилиту перевода координат.
export abstract class BaseTool {
  protected container: HTMLDivElement;
  protected camera: Camera;
  protected store: ElementStore;
  protected selection: SelectionManager;
  protected renderer: BoardRenderer;
  protected boardId: string;
  protected pushHistory: (entry: THistoryEntry) => void;
  protected getActiveTool: () => string;
  protected openEdit: (element: IElement) => void;
  protected setActiveTool: (tool: TTool) => void;

  // Сохраняет переданные зависимости в защищённые поля для наследников.
  constructor(deps: IToolDeps) {
    this.container = deps.container;
    this.camera = deps.camera;
    this.store = deps.store;
    this.selection = deps.selection;
    this.renderer = deps.renderer;
    this.boardId = deps.boardId;
    this.pushHistory = deps.pushHistory;
    this.getActiveTool = deps.getActiveTool;
    this.openEdit = deps.openEdit;
    this.setActiveTool = deps.setActiveTool;
  }

  // Реакция на pointerdown. Возврат true означает захват жеста инструментом.
  abstract onDown(event: PointerEvent): boolean | void;

  // Реакция на pointermove во время активного жеста.
  abstract onMove(event: PointerEvent): void;

  // Реакция на pointerup, завершение жеста.
  abstract onUp(event: PointerEvent): void;

  // Опциональная реакция на движение указателя без нажатия.
  onHoverMove?(event: PointerEvent): void;

  // Вызывается при выборе инструмента активным.
  onActivate?(): void;

  // Вызывается при смене активного инструмента на другой.
  onDeactivate?(): void;

  // Переводит экранные координаты клиента в мировые координаты доски.
  protected screenToWorld(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.camera.x) / this.camera.zoom,
      y: (clientY - rect.top - this.camera.y) / this.camera.zoom,
    };
  }
}
