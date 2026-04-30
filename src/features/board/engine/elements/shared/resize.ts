// Поля прямоугольника, которые масштабирует applyRectResize.
export interface IRectFields {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Опции масштабирования.
export interface IRectResizeOpts {
  // Нижняя граница ширины и высоты после масштаба.
  minWidth?: number;
  minHeight?: number;
  // Если true, scale-факторы зажимаются снизу единицей (растёт, но не уменьшается).
  // Используется в sticky для grow-only ресайза.
  growOnly?: boolean;
}

// Масштабирует прямоугольник от якорной точки (anchorX, anchorY) с factor по осям.
// Используется в snapshot-логике sticky и image при drag-resize.
export function applyRectResize(
  snapshot: IRectFields,
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  opts: IRectResizeOpts = {},
): IRectFields {
  const sx = opts.growOnly ? Math.max(1, scaleX) : scaleX;
  const sy = opts.growOnly ? Math.max(1, scaleY) : scaleY;
  const x = anchorX + (snapshot.x - anchorX) * sx;
  const y = anchorY + (snapshot.y - anchorY) * sy;
  const width = Math.max(opts.minWidth ?? 0, snapshot.width * sx);
  const height = Math.max(opts.minHeight ?? 0, snapshot.height * sy);
  return { x, y, width, height };
}
