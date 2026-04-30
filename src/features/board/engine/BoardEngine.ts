import "@engine/elements/register-handlers";

import {
  ICamera,
  IElement,
  ISelectionBox,
  IWsCursorUpdated,
  IWsOnlineUser,
  TPenTool,
  TShapeKind,
  TTool,
} from "@engine/types";
import { TConnectionStatus } from "@engine/types/ui.types";

import { Camera } from "@engine/core/Camera";
import { ElementStore } from "@engine/core/ElementStore";
import { SelectionManager } from "@engine/selection/SelectionManager";
import { BoardRenderer } from "@engine/renderer/BoardRenderer";
import { GridRenderer } from "@engine/renderer/GridRenderer";
import { WheelZoom } from "@engine/viewport/WheelZoom";
import { PointerPan } from "@engine/viewport/PointerPan";
import { CursorEmitter } from "@engine/viewport/CursorEmitter";
import { ZoomController } from "@engine/viewport/ZoomController";
import { SelectionBox } from "@engine/selection/SelectionBox";
import { BaseTool } from "@engine/tools/BaseTool";
import { ToolManager } from "@engine/tools/ToolManager";
import { PencilTool } from "@engine/tools/PencilTool";
import { EraserTool } from "@engine/tools/EraserTool";
import { SelectTool } from "@engine/tools/select/SelectTool";
import { TextTool } from "@engine/tools/TextTool";
import { StickyTool } from "@engine/tools/StickyTool";
import { ShapeTool } from "@engine/tools/ShapeTool";
import { BoardSync } from "@engine/sync/BoardSync";
import { KeyboardHandler } from "@engine/keyboard/KeyboardHandler";
import { AnchorOverlay } from "@engine/anchors/AnchorOverlay";
import { InputRouter } from "@engine/input/InputRouter";
import { ImageCache } from "@engine/image/ImageCache";
import { attachTextLinkCacheCleanup } from "@engine/elements/handlers/text.handler";
import { ImageUploader } from "@engine/image/ImageUploader";
import { PasteHandler } from "@engine/image/PasteHandler";
import { EditingController } from "@engine/editor/EditingController";

// Узкий контракт для тулов, у которых есть armed-цвет заливки.
// Сейчас реализуется только StickyTool, но дизайн duck-type — добавить новый
// armed-tool можно без правок BoardEngine.
interface IArmedColorTool {
  setArmedColor(color: string): void;
}

function hasSetArmedColor(tool: BaseTool): tool is BaseTool & IArmedColorTool {
  return typeof (tool as Partial<IArmedColorTool>).setArmedColor === "function";
}

// Узкий контракт для тулов с armed-подвидом формы. Сейчас реализуется только
// ShapeTool, но дизайн duck-type позволяет добавить новые armed-tool'ы без правок BoardEngine.
interface IShapeKindArmedTool {
  setArmedShapeKind(kind: TShapeKind): void;
}

function hasSetArmedShapeKind(
  tool: BaseTool,
): tool is BaseTool & IShapeKindArmedTool {
  return (
    typeof (tool as Partial<IShapeKindArmedTool>).setArmedShapeKind ===
    "function"
  );
}

// Карта событий движка с типизированной payload-ой.
// Подписка через engine.on(event, cb), внутри движка — через emit.
export interface IBoardEngineEvents {
  activeToolChange: TTool;
  selectionBoxChange: ISelectionBox | null;
  usersChange: IWsOnlineUser[];
  userLeft: string;
  cursorUpdated: IWsCursorUpdated;
  cursorRemoved: string;
  zoomChange: number;
  connectionStatus: TConnectionStatus;
  boardError: string;
  boardReady: void;
  toast: string;
}

export type TBoardEngineEvent = keyof IBoardEngineEvents;

export type TBoardEngineListener<E extends TBoardEngineEvent> = (
  data: IBoardEngineEvents[E],
) => void;

type TAnyListener = (data: unknown) => void;

export interface IBoardEngineOptions {
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  boardId: string;
  userId: string;
}

export class BoardEngine {
  public readonly camera: Camera;

  private readonly container: HTMLDivElement;
  private readonly listeners = new Map<TBoardEngineEvent, Set<TAnyListener>>();
  private readonly userId: string;
  private readonly boardId: string;

  private readonly store: ElementStore;
  private readonly selection: SelectionManager;
  private readonly renderer: BoardRenderer;
  private readonly grid: GridRenderer;
  private readonly sync: BoardSync;
  private readonly tools: ToolManager;
  private readonly editing: EditingController;
  private readonly wheelZoom: WheelZoom;
  private readonly pointerPan: PointerPan;
  private readonly cursorEmitter: CursorEmitter;
  private readonly zoomController: ZoomController;
  private readonly selectionBox: SelectionBox;
  private readonly keyboard: KeyboardHandler;
  private readonly anchorOverlay: AnchorOverlay;
  private readonly input: InputRouter;
  private readonly pasteHandler: PasteHandler;

  private unsubscribeSelectionChrome: (() => void) | null = null;
  private unsubscribeTextLinkCleanup: (() => void) | null = null;
  private unsubscribeCameraZoomEmit: (() => void) | null = null;
  private unsubscribeCameraSave: (() => void) | null = null;
  private cameraSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: IBoardEngineOptions) {
    const { canvas, container, boardId, userId } = options;

    this.container = container;
    this.userId = userId;
    this.boardId = boardId;

    const core = this.buildCore();
    this.camera = core.camera;
    this.store = core.store;
    this.selection = core.selection;
    this.input = core.input;

    // Подписываем text-link-cache на удаления из стора, чтобы он чистил
    // зоны кликабельных ссылок для удалённых текстовых элементов.
    this.unsubscribeTextLinkCleanup = attachTextLinkCacheCleanup(this.store);

    const rendering = this.buildRendering(canvas);
    this.renderer = rendering.renderer;
    this.grid = rendering.grid;

    // Renderer уже передал camera viewport-размер, поэтому здесь можно центрировать
    // или восстанавливать сохранённую позицию из localStorage без риска clamp в нулевой viewport.
    this.setupCameraPersistence();

    this.sync = this.buildSync();
    this.anchorOverlay = this.buildAnchorOverlay();

    const editing = this.buildEditing();
    this.tools = editing.tools;
    this.editing = editing.editing;

    const viewport = this.buildViewportInteractions();
    this.wheelZoom = viewport.wheelZoom;
    this.pointerPan = viewport.pointerPan;
    this.zoomController = viewport.zoomController;
    this.cursorEmitter = viewport.cursorEmitter;

    this.selectionBox = this.buildSelectionUi();
    this.keyboard = this.buildKeyboard();
    this.pasteHandler = this.buildPasteHandler();

    this.wireInputRouter();
  }

  // Подключает сокет, события мыши/клавиатуры и активирует select.
  start(): void {
    this.sync.connect();
    this.wheelZoom.attach();
    this.input.attach(this.container);
    this.keyboard.attach();
    this.pasteHandler.attach();
    this.anchorOverlay.attach();
    this.tools.getTool("select")?.onActivate?.();
  }

  // Отключает все подсистемы и освобождает ресурсы.
  destroy(): void {
    this.zoomController.destroy();
    this.sync.disconnect();
    this.wheelZoom.detach();
    this.input.detach();
    this.keyboard.detach();
    this.pasteHandler.detach();
    this.anchorOverlay.destroy();
    this.unsubscribeSelectionChrome?.();
    this.unsubscribeSelectionChrome = null;
    this.unsubscribeTextLinkCleanup?.();
    this.unsubscribeTextLinkCleanup = null;
    this.unsubscribeCameraZoomEmit?.();
    this.unsubscribeCameraZoomEmit = null;
    this.unsubscribeCameraSave?.();
    this.unsubscribeCameraSave = null;
    if (this.cameraSaveTimer !== null) {
      clearTimeout(this.cameraSaveTimer);
      this.cameraSaveTimer = null;
    }
    // Финальный flush, чтобы при закрытии вкладки/смене доски сохранился последний кадр.
    this.saveCameraState();
    this.renderer.destroy();
    this.grid.destroy();
    this.editing.destroy();
    this.tools.getTool("select")?.onDeactivate?.();
  }

  // Переключает активный инструмент. Сбрасывает выделение для всех кроме select.
  setTool(nextTool: TTool): void {
    const isSelect = nextTool === "select";
    if (!isSelect) this.selection.clearAll();
    this.selectionBox.setActiveTool(nextTool);
    this.pointerPan.setActiveTool(nextTool);
    this.tools.setActiveTool(nextTool);
    this.anchorOverlay.setMode(isSelect ? "selectOnly" : "off");
    this.emit("activeToolChange", nextTool);
  }

  // Переключает подтип карандаша (pencil/marker/highlighter).
  setPenTool(tool: TPenTool): void {
    this.tools.setPenTool(tool);
  }

  // Имя активного инструмента.
  getActiveTool(): string {
    return this.tools.getActiveTool();
  }

  // Имя активного подтипа карандаша.
  getActivePenTool(): string {
    return this.tools.getActivePenTool();
  }

  // Увеличивает масштаб на один шаг.
  zoomIn(): void {
    this.zoomController.zoomIn();
  }

  // Уменьшает масштаб на один шаг.
  zoomOut(): void {
    this.zoomController.zoomOut();
  }

  // Откатывает последнее действие истории.
  undo(): void {
    this.sync.undo();
  }

  // Применяет следующее действие истории, если есть.
  redo(): void {
    this.sync.redo();
  }

  // Задаёт цвет заливки на всех тулах, которые поддерживают armed-color.
  // Сейчас реагирует только StickyTool; новые armed-tool'ы подхватятся
  // автоматически по факту реализации setArmedColor.
  setArmedColor(color: string): void {
    for (const tool of this.tools.allTools()) {
      if (hasSetArmedColor(tool)) tool.setArmedColor(color);
    }
  }

  // Задаёт активный shapeKind на всех тулах, поддерживающих armed-shape-kind.
  // Сейчас реагирует только ShapeTool; новые armed-tool'ы подхватятся
  // автоматически по факту реализации setArmedShapeKind.
  setArmedShapeKind(kind: TShapeKind): void {
    for (const tool of this.tools.allTools()) {
      if (hasSetArmedShapeKind(tool)) tool.setArmedShapeKind(kind);
    }
  }

  // Подписка на событие движка. Возвращает функцию отписки.
  on<E extends TBoardEngineEvent>(
    event: E,
    listener: TBoardEngineListener<E>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = listener as TAnyListener;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  // Уведомляет всех подписчиков события. Используется только внутри движка.
  private emit<E extends TBoardEngineEvent>(
    event: E,
    data: IBoardEngineEvents[E],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as TBoardEngineListener<E>)(data);
    }
  }

  // Фундамент: камера, хранилище элементов, выделение, роутер ввода.
  private buildCore(): {
    camera: Camera;
    store: ElementStore;
    selection: SelectionManager;
    input: InputRouter;
  } {
    const camera = new Camera();
    const store = new ElementStore();
    const selection = new SelectionManager(store);
    const input = new InputRouter();
    return { camera, store, selection, input };
  }

  // Рендерер канваса, сетка и кеш загруженных картинок.
  private buildRendering(canvas: HTMLCanvasElement): {
    renderer: BoardRenderer;
    grid: GridRenderer;
  } {
    const renderer = new BoardRenderer(
      canvas,
      this.container,
      this.camera,
      this.store,
    );

    const imageCache = new ImageCache(() => {
      renderer.rebuildBuffer();
      renderer.renderFrame();
    });
    this.store.setImageCache(imageCache);

    const grid = new GridRenderer(this.container, this.camera);

    this.selection.setRenderFn(() => renderer.renderFrame());
    this.unsubscribeSelectionChrome = renderer.addChromeDrawer((ctx, cam) =>
      this.selection.drawChrome(ctx, cam),
    );

    return { renderer, grid };
  }

  // WebSocket-синхронизация состояния доски с сервером.
  private buildSync(): BoardSync {
    return new BoardSync({
      store: this.store,
      selection: this.selection,
      renderer: this.renderer,
      boardId: this.boardId,
      callbacks: {
        onUsersChange: (users) => this.emit("usersChange", users),
        onUserLeft: (userId) => this.emit("userLeft", userId),
        onCursorUpdated: (data) => this.emit("cursorUpdated", data),
        onCursorRemoved: (userId) => this.emit("cursorRemoved", userId),
        onConnectionStatus: (status) => this.emit("connectionStatus", status),
        onBoardError: (message) => this.emit("boardError", message),
        onBoardReady: () => this.emit("boardReady", undefined),
        onRemoteElementsDeleted: (ids) => this.handleRemoteElementsDeleted(ids),
      },
    });
  }

  // Оверлей точек привязки для коннекторов. Должен создаваться до buildEditing,
  // потому что SelectTool принимает его в конструкторе.
  private buildAnchorOverlay(): AnchorOverlay {
    const anchorOverlay = new AnchorOverlay({
      camera: this.camera,
      store: this.store,
      selection: this.selection,
      renderer: this.renderer,
    });
    anchorOverlay.setMode("selectOnly");
    return anchorOverlay;
  }

  // Регистрирует все инструменты и контроллер инлайн-редактирования текста/стикеров.
  private buildEditing(): {
    tools: ToolManager;
    editing: EditingController;
  } {
    const tools = new ToolManager();
    const editing = new EditingController({
      container: this.container,
      camera: this.camera,
      store: this.store,
      selection: this.selection,
      renderer: this.renderer,
      pushHistory: (entry) => this.sync.pushHistory(entry),
    });

    const toolDeps = {
      container: this.container,
      camera: this.camera,
      store: this.store,
      selection: this.selection,
      renderer: this.renderer,
      boardId: this.boardId,
      pushHistory: (entry: Parameters<BoardSync["pushHistory"]>[0]) =>
        this.sync.pushHistory(entry),
      getActiveTool: () => tools.getResolvedTool(),
      openEdit: (el: IElement) => editing.openEdit(el),
      setActiveTool: (tool: TTool) => this.setTool(tool),
    };

    tools.register("pencil", new PencilTool(toolDeps));
    tools.register("eraser", new EraserTool(toolDeps));
    tools.register("select", new SelectTool(toolDeps, this.anchorOverlay));
    tools.register("text", new TextTool(toolDeps));
    tools.register("sticky", new StickyTool(toolDeps));
    tools.register("shape", new ShapeTool(toolDeps));

    return { tools, editing };
  }

  // Зум колесом, панорамирование мышью, кнопочный зум и эмиттер курсора.
  private buildViewportInteractions(): {
    wheelZoom: WheelZoom;
    pointerPan: PointerPan;
    zoomController: ZoomController;
    cursorEmitter: CursorEmitter;
  } {
    const wheelZoom = new WheelZoom(
      this.container,
      this.camera,
      this.schedulePanRender,
      this.scheduleZoomRender,
    );

    const pointerPan = new PointerPan(
      this.container,
      this.camera,
      this.schedulePanRender,
      this.scheduleZoomRender,
    );

    const zoomController = new ZoomController(
      this.container,
      this.camera,
      this.scheduleZoomRender,
    );

    const cursorEmitter = new CursorEmitter(
      this.container,
      this.camera,
      (wx, wy) => this.sync.emitCursorMove(wx, wy),
    );

    // Единый источник zoomChange: камера notify ловит и wheel, и pinch, и кнопочный зум.
    let lastZoom = this.camera.zoom;
    this.unsubscribeCameraZoomEmit = this.camera.subscribe(() => {
      if (this.camera.zoom === lastZoom) return;
      lastZoom = this.camera.zoom;
      this.emit("zoomChange", this.camera.zoom);
    });

    return { wheelZoom, pointerPan, zoomController, cursorEmitter };
  }

  // Прямоугольная рамка выделения мышью.
  private buildSelectionUi(): SelectionBox {
    return new SelectionBox({
      el: this.container,
      camera: this.camera,
      scheduleRender: this.schedulePanRender,
      onBoxChange: (box) => this.emit("selectionBoxChange", box),
      onSelectionEnd: (wMinX, wMinY, wMaxX, wMaxY) => {
        this.selection.selectInRect(wMinX, wMinY, wMaxX, wMaxY);
      },
      onSelectionPreview: (wMinX, wMinY, wMaxX, wMaxY) => {
        this.selection.previewSelectInRect(wMinX, wMinY, wMaxX, wMaxY);
      },
    });
  }

  // Глобальные хоткеи undo/redo.
  private buildKeyboard(): KeyboardHandler {
    return new KeyboardHandler({
      undo: () => this.sync.undo(),
      redo: () => this.sync.redo(),
    });
  }

  // Вставка картинок из буфера обмена с загрузкой на сервер.
  private buildPasteHandler(): PasteHandler {
    const uploader = new ImageUploader({
      sync: this.sync,
      store: this.store,
      renderer: this.renderer,
      boardId: this.boardId,
    });
    return new PasteHandler({
      container: this.container,
      camera: this.camera,
      store: this.store,
      selection: this.selection,
      renderer: this.renderer,
      input: this.input,
      pushHistory: (entry) => this.sync.pushHistory(entry),
      uploader,
      boardId: this.boardId,
      userId: this.userId,
      onToast: (msg) => this.emit("toast", msg),
    });
  }

  // Подключает участников к роутеру событий ввода.
  private wireInputRouter(): void {
    this.input.register(this.tools);
    this.input.register(this.selectionBox);
    this.input.observe(this.pointerPan);
    this.input.observe(this.cursorEmitter);
  }

  // Восстанавливает позицию камеры из localStorage; если её нет — центрирует на середине рабочей области.
  // Подписку на сохранение ставим уже после restore, чтобы первый notify от copyFrom не отправил сам же
  // только что прочитанное значение обратно.
  private setupCameraPersistence(): void {
    const saved = this.loadCameraState();
    if (saved) {
      this.camera.copyFrom(saved);
    } else {
      this.camera.centerView();
    }
    this.unsubscribeCameraSave = this.camera.subscribe(() =>
      this.scheduleSaveCamera(),
    );
  }

  // Дебаунс на запись в localStorage, чтобы не дёргать диск каждый кадр pan/zoom.
  private scheduleSaveCamera(): void {
    if (this.cameraSaveTimer !== null) clearTimeout(this.cameraSaveTimer);
    this.cameraSaveTimer = setTimeout(() => {
      this.cameraSaveTimer = null;
      this.saveCameraState();
    }, 500);
  }

  // Пишет текущий снимок камеры в localStorage. Молча игнорирует ошибки доступа.
  private saveCameraState(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        this.cameraStorageKey(),
        JSON.stringify(this.camera.snapshot()),
      );
    } catch {
      // Приватный режим, заполненная квота, отключённый storage  не блокируем доску.
    }
  }

  // Читает сохранённый снимок камеры; возвращает null если ничего нет или формат битый.
  private loadCameraState(): ICamera | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(this.cameraStorageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.zoom === "number"
      ) {
        return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Per-board ключ для камеры, namespace nova: чтобы не пересекаться с другими приложениями.
  private cameraStorageKey(): string {
    return `nova:board:${this.boardId}:camera`;
  }

  // Перерисовка сетки и канваса при панорамировании.
  private schedulePanRender = (): void => {
    this.grid.schedulePanRender();
    this.renderer.schedulePanRender();
  };

  // Перерисовка с пересборкой буфера при изменении масштаба.
  private scheduleZoomRender = (): void => {
    this.grid.scheduleZoomRender();
    this.renderer.scheduleBufferRebuild();
  };

  // Закрывает редактор, если редактируемый элемент удалили на другой вкладке.
  private handleRemoteElementsDeleted(ids: Set<string>): void {
    const id = this.editing.getEditingId();
    if (id && ids.has(id)) this.editing.cancelExternal(id);
  }
}
