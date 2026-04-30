import type { IShapeElement } from "@engine/types";
import type { IElementResolver } from "@engine/elements/interfaces/element-handler";
import type {
  IEditableContent,
  IEditingBounds,
  IEditableDefaults,
} from "@engine/elements/interfaces/editable-element-handler";
import { pickTextColor } from "@engine/utils/contrast";
import { drawShape } from "./shape.draw";
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  SHAPE_FILL_PALETTE,
  SHAPE_KIND_LIST,
  SHAPE_STROKE_PALETTE,
  SHAPE_TEXT_PADDING,
  STICKY_DEFAULT_FONT_SIZE,
} from "@/features/board/constants/board.constant";

// Извлекает редактируемый контент shape для inline-оверлея.
export function getEditableContentShape(el: IShapeElement): IEditableContent {
  return {
    text: el.text,
    html: el.html,
    fontSize: el.fontSize,
    textAlign: el.textAlign,
  };
}

// Применяет отредактированный контент к (склонированному) shape.
export function applyEditedContentShape(
  el: IShapeElement,
  content: IEditableContent,
): IShapeElement {
  return {
    ...el,
    text: content.text,
    html: content.html,
    fontSize: content.fontSize,
    textAlign: content.textAlign,
  };
}

// Bounds оверлея для shape. Возвращает shape-специфичные поля (strokeColor, shapeKind, palettes)
// для shapeMode toolbar в EditingController.
export function getEditingBoundsShape(
  el: IShapeElement,
  _resolver: IElementResolver,
): IEditingBounds {
  const isTransparent = el.fillColor === "transparent";
  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    padding: SHAPE_TEXT_PADDING,
    background: isTransparent ? "transparent" : el.fillColor,
    color: isTransparent ? DEFAULT_STROKE_COLOR : pickTextColor(el.fillColor),
    palette: SHAPE_FILL_PALETTE,
    strokePalette: SHAPE_STROKE_PALETTE,
    strokeColor: el.strokeColor,
    shapeKind: el.shapeKind,
    shapeKinds: SHAPE_KIND_LIST,
  };
}

// Создаёт пустой shape в (worldX, worldY) дефолтным rect-подвидом. ShapeTool сам
// конструирует элемент через drag-out, но интерфейс IEditableElementHandler требует наличия метода.
export function createEmptyShape(
  worldX: number,
  worldY: number,
  defaults: IEditableDefaults,
): IShapeElement {
  const width = defaults.initialSize?.width ?? DEFAULT_SHAPE_SIZE;
  const height = defaults.initialSize?.height ?? DEFAULT_SHAPE_SIZE;
  return {
    id: crypto.randomUUID(),
    type: "shape",
    userId: "",
    boardId: defaults.boardId,
    createdAt: Date.now(),
    shapeKind: "rect",
    x: worldX - width / 2,
    y: worldY - height / 2,
    width,
    height,
    strokeColor: DEFAULT_STROKE_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fillColor: defaults.fill ?? DEFAULT_SHAPE_FILL,
    text: "",
    html: "",
    fontSize: defaults.fontSize ?? STICKY_DEFAULT_FONT_SIZE,
    autoFontSize: true,
    textAlign: "center",
  };
}

// Поля shape, влияющие на видимое состояние; commit пишет history-entry "edit"
// только если хотя бы одно из них изменилось.
const SHAPE_HISTORY_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "shapeKind",
  "strokeColor",
  "strokeWidth",
  "fillColor",
  "text",
  "html",
  "fontSize",
  "autoFontSize",
  "textAlign",
] as const;

// Рисует контур и заливку фигуры без текста. Используется EditingController
// как ghost-worldDrawer, чтобы под прозрачным editor-div была видна реальная форма
// (ellipse/diamond/triangle, не прямоугольник). Текст уже отображается в editor-div.
export function drawDuringEditShape(
  ctx: CanvasRenderingContext2D,
  el: IShapeElement,
  resolver: IElementResolver,
): void {
  drawShape(ctx, { ...el, text: "", html: "" }, resolver);
}

// Shallow-сравнение снимков по ключевым полям. Возвращает false если ничего не поменялось.
export function shouldRecordEditShape(
  oldSnapshot: unknown,
  newSnapshot: unknown,
): boolean {
  if (!oldSnapshot || !newSnapshot) return true;
  const a = oldSnapshot as Record<string, unknown>;
  const b = newSnapshot as Record<string, unknown>;
  for (const key of SHAPE_HISTORY_KEYS) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}
