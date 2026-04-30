import {
  DEFAULT_TEXT_FONT_SIZE,
  EDITOR_TOOLBAR_AFTER_SHOW_GRACE_MS,
  EDITOR_TOOLBAR_MIN_PAN_DELTA_PX,
  EDITOR_TOOLBAR_REVEAL_DELAY_MS,
  STICKY_DEFAULT_FONT_SIZE,
  STICKY_MAX_FONT_SIZE,
  STICKY_MIN_FONT_SIZE,
  STICKY_PADDING,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from "@/features/board/constants/board.constant";
import type { TShapeKind } from "@engine/types";
import { computeAutoFontSize } from "@engine/elements/shared/auto-font-size";
import { computeShapeTextRect } from "@engine/elements/handlers/shape/shape.draw";
import { Camera } from "@engine/core/Camera";
import { getEditableText, sanitizePastedHtml } from "./editor.text-utils";
import {
  createEditable,
  createFrame,
  createMeasureDiv,
  createMeasurer,
  injectOverlayStyles,
} from "./editor.dom";
import { attachEditorEvents } from "./editor.events";
import {
  subscribeCameraReposition,
  syncContainerFrame,
  syncTextFrame,
} from "./editor.position";
import { EditorResize } from "./editor.resize";
import { buildToolbarCallbacks } from "./editor.toolbar";
import { TextEditorCommands } from "./TextEditorCommands";
import { TextEditorToolbarAdapter } from "./TextEditorToolbarAdapter";

export type { IToolbarCallbacks } from "./TextEditorToolbarAdapter";

type TTextAlign = "left" | "center" | "right";

// Колбэки финализации и отмены inline-редактора текста.
export interface ITextOverlayCallbacks {
  onFinalize: (
    text: string,
    html: string,
    worldX: number,
    worldY: number,
    fontSize: number,
    textAlign: TTextAlign,
  ) => void;
  onCancel: () => void;
}

// Параметры режима sticky: bbox, текущий цвет, палитра и колбэк смены цвета.
export interface IStickyContainerMode {
  bbox: { x: number; y: number; w: number; h: number };
  color: string;
  palette: readonly string[];
  onColorChange: (color: string) => void;
}

// Параметры режима shape: bbox, fill (как bg), stroke и shape-kind переключатель.
// Параллелен IStickyContainerMode, EditingController выбирает один по дискриминатору bounds.
export interface IShapeContainerMode {
  bbox: { x: number; y: number; w: number; h: number };
  fillColor: string;
  fillPalette: readonly string[];
  onFillChange: (color: string) => void;
  strokeColor: string;
  strokePalette: readonly string[];
  onStrokeChange: (color: string) => void;
  shapeKind: TShapeKind;
  shapeKinds: readonly TShapeKind[];
  onShapeKindChange: (kind: TShapeKind) => void;
}

// Дополнительные опции редактора (sticky-режим, shape-режим и пр.).
export interface ITextEditorExtraOpts {
  containerMode?: IStickyContainerMode;
  shapeMode?: IShapeContainerMode;
}

// Inline-редактор текста и стикеров поверх canvas. Координирует DOM, события,
// тулбар, ресайз и синхронизацию позиции с камерой.
export class TextEditorOverlay {
  private readonly container: HTMLDivElement;
  private readonly camera: Camera;
  private readonly callbacks: ITextOverlayCallbacks;

  private frame: HTMLDivElement | null = null;
  private editable: HTMLDivElement | null = null;
  private measurer: HTMLSpanElement | null = null;
  private measureDiv: HTMLDivElement | null = null;
  private commands: TextEditorCommands | null = null;
  private toolbar: TextEditorToolbarAdapter | null = null;
  private resizer: EditorResize | null = null;
  private detachEvents: (() => void) | null = null;
  private cameraUnsub: (() => void) | null = null;

  private worldPos = { x: 0, y: 0 };
  private fontSize = DEFAULT_TEXT_FONT_SIZE;
  private textAlign: TTextAlign = "left";
  private containerMode: IStickyContainerMode | null = null;
  private currentColor: string | null = null;
  private shapeMode: IShapeContainerMode | null = null;
  private currentFillColor: string | null = null;
  private currentStrokeColor: string | null = null;
  private currentShapeKind: TShapeKind | null = null;
  private syncQueued = false;
  private suppressBlur = false;
  private destroyed = false;
  private cameraIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private toolbarHidden = false;
  private toolbarShownAt = 0;
  private lastCamSnap: { x: number; y: number; zoom: number } | null = null;

  constructor(
    container: HTMLDivElement,
    camera: Camera,
    callbacks: ITextOverlayCallbacks,
    initialPos: { x: number; y: number } = { x: 0, y: 0 },
    initialSize: number = DEFAULT_TEXT_FONT_SIZE,
    initialText?: string,
    initialHtml?: string,
    initialAlign?: TTextAlign,
    extra: ITextEditorExtraOpts = {},
  ) {
    this.container = container;
    this.camera = camera;
    this.callbacks = callbacks;
    this.worldPos = { ...initialPos };
    this.fontSize = initialSize;
    this.textAlign = initialAlign ?? "left";
    this.containerMode = extra.containerMode ?? null;
    this.currentColor = extra.containerMode?.color ?? null;
    this.shapeMode = extra.shapeMode ?? null;
    this.currentFillColor = extra.shapeMode?.fillColor ?? null;
    this.currentStrokeColor = extra.shapeMode?.strokeColor ?? null;
    this.currentShapeKind = extra.shapeMode?.shapeKind ?? null;
    this.mount(initialText, initialHtml);
  }

  // Завершает редактирование и вызывает onFinalize с текущим состоянием.
  finalize(): void {
    if (this.destroyed) return;
    const editable = this.editable;
    if (!editable) return;
    const text = getEditableText(editable).replace(/\n+$/, "");
    const html = editable.innerHTML.replace(/(<div><br\s*\/?><\/div>)+$/i, "");
    const textAlign = this.textAlign;
    this.destroy();
    this.callbacks.onFinalize(
      text,
      html,
      this.worldPos.x,
      this.worldPos.y,
      this.fontSize,
      textAlign,
    );
  }

  // Отменяет редактирование без коммита.
  cancel(): void {
    if (this.destroyed) return;
    this.destroy();
    this.callbacks.onCancel();
  }

  // Полностью разрушает оверлей: DOM, события, подписки.
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.cameraIdleTimer !== null) {
      clearTimeout(this.cameraIdleTimer);
      this.cameraIdleTimer = null;
    }
    this.cameraUnsub?.();
    this.cameraUnsub = null;
    this.detachEvents?.();
    this.detachEvents = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.frame?.remove();
    this.frame = null;
    this.editable = null;
    this.measurer?.remove();
    this.measurer = null;
    this.measureDiv?.remove();
    this.measureDiv = null;
    this.commands = null;
    this.resizer?.detach();
    this.resizer = null;
  }

  // Меняет цвет фона sticky-контейнера и пробрасывает его наружу.
  setContainerColor(color: string): void {
    if (!this.containerMode) return;
    this.currentColor = color;
    this.containerMode.onColorChange(color);
    this.toolbar?.pushStickyState({ currentColor: color });
    this.syncToCamera();
  }

  // Меняет fill цвет shape-overlay и пробрасывает наружу.
  setShapeFillColor(color: string): void {
    if (!this.shapeMode) return;
    this.currentFillColor = color;
    this.shapeMode.onFillChange(color);
    this.toolbar?.pushShapeState({ currentFillColor: color });
    this.syncToCamera();
  }

  // Меняет stroke цвет shape-overlay и пробрасывает наружу.
  setShapeStrokeColor(color: string): void {
    if (!this.shapeMode) return;
    this.currentStrokeColor = color;
    this.shapeMode.onStrokeChange(color);
    this.toolbar?.pushShapeState({ currentStrokeColor: color });
    this.syncToCamera();
  }

  // Меняет shapeKind и пробрасывает наружу. Overlay остаётся прямоугольным,
  // но inscribed-rect меняется - пересчитываем auto-fit fontSize.
  setShapeKind(kind: TShapeKind): void {
    if (!this.shapeMode) return;
    this.currentShapeKind = kind;
    this.shapeMode.onShapeKindChange(kind);
    this.toolbar?.pushShapeState({ shapeKind: kind });
    this.recomputeAutoShape();
    this.syncToCamera();
  }

  // Полная инициализация DOM, ресайзера, команд, тулбара и подписок.
  private mount(initialText?: string, initialHtml?: string): void {
    const { sx, sy } = this.camera.worldToScreen(
      this.worldPos.x,
      this.worldPos.y,
    );
    const zoomedFontSize = this.fontSize * this.camera.zoom;
    const zoomedLineHeight = zoomedFontSize * TEXT_LINE_HEIGHT;

    injectOverlayStyles();
    this.createMeasurementNodes(zoomedFontSize, zoomedLineHeight);
    this.frame = createFrame(sx, sy);
    // sticky/shape: без плейсхолдера, пустой бокс выглядит чище.
    const withPlaceholder = !this.containerMode && !this.shapeMode;
    this.editable = createEditable(
      zoomedFontSize,
      zoomedLineHeight,
      initialText,
      initialHtml,
      withPlaceholder,
    );
    this.attachEditableListeners(this.editable);

    if (!this.containerMode && !this.shapeMode) {
      this.attachResizer();
    }

    this.frame.appendChild(this.editable);
    this.container.appendChild(this.frame);

    this.commands = new TextEditorCommands(this.editable, {
      notifyChange: () => this.syncToCamera(),
      onListStateChange: (type) => this.toolbar?.pushListState(type),
    });
    this.commands.updateListIndices();

    this.toolbar = this.createToolbar();

    this.syncToCamera();
    this.cameraUnsub = subscribeCameraReposition(this.camera, () =>
      this.handleCameraActivity(),
    );
    this.scheduleInitialFocus(initialText, initialHtml);
  }

  // Прячет тулбар на время pan/zoom. Шум трекпада (микро-дельты, лифт-артефакты)
  // и активность сразу после reveal игнорируются, чтобы тулбар не дёргался зря.
  private handleCameraActivity(): void {
    this.queueSync();
    const cam = this.camera;
    const last = this.lastCamSnap;
    this.lastCamSnap = { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (last) {
      const dxy = Math.abs(cam.x - last.x) + Math.abs(cam.y - last.y);
      const dzoom = Math.abs(cam.zoom - last.zoom);
      if (dxy < EDITOR_TOOLBAR_MIN_PAN_DELTA_PX && dzoom < 0.001) return;
    }
    if (
      performance.now() - this.toolbarShownAt <
      EDITOR_TOOLBAR_AFTER_SHOW_GRACE_MS
    ) {
      return;
    }
    if (!this.toolbarHidden && this.toolbar) {
      this.toolbar.setVisible(false);
      this.toolbarHidden = true;
    }
    if (this.cameraIdleTimer !== null) {
      clearTimeout(this.cameraIdleTimer);
    }
    this.cameraIdleTimer = setTimeout(() => {
      this.cameraIdleTimer = null;
      if (this.destroyed) return;
      this.toolbarHidden = false;
      this.toolbar?.setVisible(true);
      this.syncToCamera();
      this.toolbarShownAt = performance.now();
    }, EDITOR_TOOLBAR_REVEAL_DELAY_MS);
  }

  // Создаёт скрытые measurer-узлы и помещает их в body.
  private createMeasurementNodes(fontSizePx: number, lineHeightPx: number): void {
    this.measurer = createMeasurer(fontSizePx, lineHeightPx);
    document.body.appendChild(this.measurer);
    this.measureDiv = createMeasureDiv(fontSizePx, lineHeightPx);
    document.body.appendChild(this.measureDiv);
  }

  // Подключает угловые ручки ресайза для текстового режима.
  private attachResizer(): void {
    if (!this.frame) return;
    this.resizer = new EditorResize({
      container: this.container,
      camera: this.camera,
      getRefs: () => ({
        measurer: this.measurer,
        editable: this.editable,
        measureDiv: this.measureDiv,
      }),
      getWorldPos: () => this.worldPos,
      setWorldPos: (pos) => {
        this.worldPos = pos;
      },
      getFontSize: () => this.fontSize,
      setFontSize: (size) => {
        this.fontSize = size;
      },
      setSuppressBlur: (suppress) => {
        this.suppressBlur = suppress;
      },
      requestSync: () => this.queueSync(),
      focusEditable: () => this.editable?.focus(),
    });
    this.resizer.attachCornerHandles(this.frame);
  }

  // Создаёт адаптер тулбара с правильными колбэками для текущего режима.
  private createToolbar(): TextEditorToolbarAdapter {
    const stickyMode = this.containerMode
      ? {
          palette: this.containerMode.palette,
          currentColor: this.currentColor ?? this.containerMode.color,
          onPaletteChange: (color: string) => this.setContainerColor(color),
        }
      : undefined;

    const shapeMode = this.shapeMode
      ? {
          fillPalette: this.shapeMode.fillPalette,
          currentFillColor: this.currentFillColor ?? this.shapeMode.fillColor,
          onFillChange: (color: string) => this.setShapeFillColor(color),
          strokePalette: this.shapeMode.strokePalette,
          currentStrokeColor:
            this.currentStrokeColor ?? this.shapeMode.strokeColor,
          onStrokeChange: (color: string) => this.setShapeStrokeColor(color),
          shapeKind: this.currentShapeKind ?? this.shapeMode.shapeKind,
          shapeKinds: this.shapeMode.shapeKinds,
          onShapeKindChange: (kind: TShapeKind) => this.setShapeKind(kind),
        }
      : undefined;

    const toolbarCallbacks = buildToolbarCallbacks({
      getEditable: () => this.editable,
      getCommands: () => this.commands,
      getToolbar: () => this.toolbar,
      setFontSize: (size) => {
        this.fontSize = size;
      },
      setTextAlign: (align) => {
        this.textAlign = align;
      },
      setSuppressBlur: (suppress) => {
        this.suppressBlur = suppress;
      },
      requestSync: () => this.syncToCamera(),
    });

    return new TextEditorToolbarAdapter(
      {
        parent: this.container,
        editable: this.editable!,
        initialFontSize: this.fontSize,
        initialAlign: this.textAlign,
        onFocusLost: () => {
          if (this.suppressBlur || this.destroyed) return;
          this.finalize();
        },
        stickyMode,
        shapeMode,
      },
      toolbarCallbacks,
    );
  }

  // Ставит фокус и каретку в конец содержимого после первого кадра.
  private scheduleInitialFocus(initialText?: string, initialHtml?: string): void {
    requestAnimationFrame(() => {
      if (this.destroyed || !this.editable) return;
      this.editable.focus({ preventScroll: true });
      if (!initialText && !initialHtml) return;
      const selection = window.getSelection();
      if (!selection) return;
      selection.selectAllChildren(this.editable);
      selection.collapseToEnd();
    });
  }

  // Откладывает sync до следующего кадра, чтобы избежать лавины пересчётов.
  private queueSync(): void {
    if (this.syncQueued || this.destroyed) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      if (!this.destroyed) this.syncToCamera();
    });
  }

  // Подписывает editable на пользовательский ввод и редакторские события.
  private attachEditableListeners(editable: HTMLDivElement): void {
    this.detachEvents = attachEditorEvents(editable, {
      onInput: () => {
        this.commands?.updateListIndices();
        // В sticky/shape-режиме шрифт всегда auto-fit под bbox.
        if (this.containerMode) this.recomputeAuto();
        if (this.shapeMode) this.recomputeAutoShape();
        this.syncToCamera();
      },
      onPointerDown: (event) => this.handleEditablePointerDown(event),
      onCancel: () => this.cancel(),
      onEnter: () => {
        this.commands?.handleEnter();
      },
      onBlur: (event) => this.handleEditableBlur(event, editable),
      onPaste: (event) => this.handleEditablePaste(event),
    });
  }

  // Открывает ссылку при ctrl/cmd+click и гасит дальнейшее распространение.
  private handleEditablePointerDown(event: PointerEvent): void {
    const target = event.target as Element;
    if (event.ctrlKey || event.metaKey) {
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (anchor?.href) {
        window.open(anchor.href, "_blank", "noopener,noreferrer");
      }
    }
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  // На blur финализирует редактор, если фокус не ушёл в собственный тулбар.
  private handleEditableBlur(event: FocusEvent, editable: HTMLDivElement): void {
    const relatedTarget = event.relatedTarget as Element | null;
    requestAnimationFrame(() => {
      if (this.suppressBlur || this.destroyed) return;
      if (relatedTarget && this.toolbar?.contains(relatedTarget)) return;
      if (this.editable === editable) this.finalize();
    });
  }

  // Очищает HTML вставки и направляет её через TextEditorCommands.
  private handleEditablePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const clipboardData = event.clipboardData;
    if (!clipboardData || !this.commands) return;
    const html = clipboardData.getData("text/html");
    const text = clipboardData.getData("text/plain") || "";
    if (html) {
      const sanitized = sanitizePastedHtml(html);
      if (sanitized) {
        this.commands.pasteHtml(sanitized);
        return;
      }
    }
    if (!text) return;
    this.commands.pasteText(text);
  }

  // Перепозиционирует фрейм/тулбар согласно текущей камере и режиму.
  private syncToCamera(): void {
    const refs = {
      frame: this.frame,
      editable: this.editable,
      measurer: this.measurer,
      measureDiv: this.measureDiv,
      toolbar: this.toolbar,
    };
    const state = {
      worldPos: this.worldPos,
      fontSize: this.fontSize,
      textAlign: this.textAlign,
    };
    const html = this.editable?.innerHTML ?? "";
    if (this.shapeMode) {
      // Editor-div прозрачный, без bg/border/тени/радиуса. Реальную фигуру (fill +
      // stroke + контур ellipse/diamond/triangle) рисует ghost-worldDrawer от
      // EditingController через handler.drawDuringEdit, editor отвечает только за text input.
      // innerRect = inscribed-rect под shapeKind: editable wrap-math и позиция совпадают
      // с canvas-рендером, чтобы не было прыжка текста на коммит.
      const inner = computeShapeTextRect({
        x: this.shapeMode.bbox.x,
        y: this.shapeMode.bbox.y,
        width: this.shapeMode.bbox.w,
        height: this.shapeMode.bbox.h,
        shapeKind: this.currentShapeKind ?? this.shapeMode.shapeKind,
      });
      syncContainerFrame(
        refs,
        state,
        this.camera,
        {
          bbox: this.shapeMode.bbox,
          fallbackColor: "transparent",
          currentColor: null,
          bareFrame: true,
          innerRect: { x: inner.x, y: inner.y, w: inner.width, h: inner.height },
        },
        html,
      );
      return;
    }
    if (this.containerMode) {
      syncContainerFrame(
        refs,
        state,
        this.camera,
        {
          bbox: this.containerMode.bbox,
          fallbackColor: this.containerMode.color,
          currentColor: this.currentColor,
        },
        html,
      );
      return;
    }
    syncTextFrame(refs, state, this.camera, html);
  }

  // Пересчитывает auto-fit размер шрифта под bbox sticky.
  private recomputeAuto(): void {
    const containerMode = this.containerMode;
    const editable = this.editable;
    if (!containerMode || !editable) return;
    const innerWidth = Math.max(1, containerMode.bbox.w - 2 * STICKY_PADDING);
    const innerHeight = Math.max(1, containerMode.bbox.h - 2 * STICKY_PADDING);
    this.fontSize = computeAutoFontSize(
      editable.innerHTML,
      innerWidth,
      innerHeight,
      {
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        minFontSize: STICKY_MIN_FONT_SIZE,
        maxFontSize: STICKY_MAX_FONT_SIZE,
        defaultFontSize: STICKY_DEFAULT_FONT_SIZE,
      },
    );
  }

  // Пересчитывает auto-fit размер шрифта под inscribed-rect фигуры. Зеркалит
  // ensureAutoFontSizeShape, чтобы текст в редакторе не вылезал за контур.
  private recomputeAutoShape(): void {
    const shapeMode = this.shapeMode;
    const editable = this.editable;
    if (!shapeMode || !editable) return;
    const inner = computeShapeTextRect({
      x: shapeMode.bbox.x,
      y: shapeMode.bbox.y,
      width: shapeMode.bbox.w,
      height: shapeMode.bbox.h,
      shapeKind: this.currentShapeKind ?? shapeMode.shapeKind,
    });
    this.fontSize = computeAutoFontSize(
      editable.innerHTML,
      Math.max(1, inner.width),
      Math.max(1, inner.height),
      {
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        minFontSize: STICKY_MIN_FONT_SIZE,
        maxFontSize: STICKY_MAX_FONT_SIZE,
        defaultFontSize: STICKY_DEFAULT_FONT_SIZE,
      },
    );
  }
}
