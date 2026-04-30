import type { IShapeElement, IStrokeBbox } from "@engine/types";
import type { IElementResolver } from "@engine/elements/interfaces/element-handler";
import { rectBbox } from "@engine/utils/bbox";
import { applyRectResize } from "@engine/elements/shared/resize";
import { MIN_SHAPE_SIZE } from "@/features/board/constants/board.constant";

// Глубокая копия фигуры со смещением и новым id. Bbox сбрасывается, computeBbox
// вызовет caller (PasteHandler так делает для всех handler-ов).
export function cloneShape(
  el: IShapeElement,
  offsetX: number,
  offsetY: number,
  _resolver: IElementResolver,
): IShapeElement {
  return {
    ...el,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    x: el.x + offsetX,
    y: el.y + offsetY,
    bbox: undefined,
  };
}

// Снимок состояния для history-entry. Включает текстовые поля, иначе
// shouldRecordEditShape не увидит правок текста и WS не получит обновления.
export function takeShapeSnapshot(el: IShapeElement): unknown {
  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    shapeKind: el.shapeKind,
    strokeColor: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fillColor: el.fillColor,
    text: el.text,
    html: el.html,
    fontSize: el.fontSize,
    autoFontSize: el.autoFontSize,
    textAlign: el.textAlign,
    bbox: el.bbox ? { ...el.bbox } : undefined,
  };
}

// Накатывает снимок поверх элемента. Принимает партиал, проверяем поля.
export function restoreShapeSnapshot(
  el: IShapeElement,
  snapshot: unknown,
): void {
  const snap = snapshot as Partial<IShapeElement> & { bbox?: IStrokeBbox };
  if (typeof snap.x === "number") el.x = snap.x;
  if (typeof snap.y === "number") el.y = snap.y;
  if (typeof snap.width === "number") el.width = snap.width;
  if (typeof snap.height === "number") el.height = snap.height;
  if (snap.shapeKind !== undefined) el.shapeKind = snap.shapeKind;
  if (snap.strokeColor !== undefined) el.strokeColor = snap.strokeColor;
  if (typeof snap.strokeWidth === "number") el.strokeWidth = snap.strokeWidth;
  if (snap.fillColor !== undefined) el.fillColor = snap.fillColor;
  if (typeof snap.text === "string") el.text = snap.text;
  if (typeof snap.html === "string") el.html = snap.html;
  if (typeof snap.fontSize === "number") el.fontSize = snap.fontSize;
  if (typeof snap.autoFontSize === "boolean") el.autoFontSize = snap.autoFontSize;
  if (snap.textAlign !== undefined) el.textAlign = snap.textAlign;
  el.bbox = snap.bbox ? { ...snap.bbox } : undefined;
}

// Сдвиг фигуры на (dx, dy) от снимка. Если был bbox, тоже сдвигается.
export function applyShapeMove(
  el: IShapeElement,
  snapshot: unknown,
  dx: number,
  dy: number,
): void {
  const snap = snapshot as { x: number; y: number; bbox?: IStrokeBbox };
  el.x = snap.x + dx;
  el.y = snap.y + dy;
  if (snap.bbox) {
    el.bbox = {
      minX: snap.bbox.minX + dx,
      minY: snap.bbox.minY + dy,
      maxX: snap.bbox.maxX + dx,
      maxY: snap.bbox.maxY + dy,
    };
  } else {
    el.bbox = rectBbox(el.x, el.y, el.width, el.height);
  }
}

// Resize фигуры от якорной точки. Шаблон как у image, плюс кламп min-side
// без коррекции anchor (допускаем небольшое расхождение взамен анти-flip-логики).
export function applyShapeResize(
  el: IShapeElement,
  snapshot: unknown,
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
): void {
  const snap = snapshot as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const r = applyRectResize(
    { x: snap.x, y: snap.y, width: snap.width, height: snap.height },
    anchorX,
    anchorY,
    scaleX,
    scaleY,
  );
  el.x = r.x;
  el.y = r.y;
  el.width = Math.max(MIN_SHAPE_SIZE, r.width);
  el.height = Math.max(MIN_SHAPE_SIZE, r.height);
  el.bbox = rectBbox(el.x, el.y, el.width, el.height);
}
