import { ICamera, IElement, IEraserTrailPoint, IStroke } from "@engine/types";
import { drawStroke } from "@engine/utils/stroke";
import { getHandler } from "@engine/elements/element-registry";
import { Camera } from "@engine/core/Camera";
import { ElementStore } from "@engine/core/ElementStore";
import {
  PAD_CSS,
  ERASER_TRAIL_DURATION,
  ERASER_TRAIL_RADIUS,
  ERASER_TRAIL_ALPHA,
  ERASER_TRAIL_COLOR,
} from "@/features/board/constants/board.constant";

// Рисователь в мировых координатах (после применённого camera-трансформа).
export type TWorldEphemeralDrawer = (ctx: CanvasRenderingContext2D) => void;

// Рисователь в экранных координатах (только DPR-масштаб). Получает камеру для своих расчётов.
export type TScreenEphemeralDrawer = (
  ctx: CanvasRenderingContext2D,
  cam: Camera,
) => void;

// Рендерер доски с двойным канвасом: offscreen buffer хранит закешированные элементы,
// main canvas каждый кадр заново склеивается из buffer + эфемерных слоёв.
// Buffer пересобирается только когда камера сильно ушла или сменился zoom.
// DPR-aware: все размеры умножаются на devicePixelRatio для четкости на retina.
export class BoardRenderer {
  // Текущий незавершённый штрих карандаша. Меняется через setCurrentStroke.
  private currentStroke: IStroke | null = null;
  // Активные точки следа ластика. Пополняется через addEraserTrailPoint.
  private eraserTrail: IEraserTrailPoint[] = [];

  private canvas: HTMLCanvasElement;
  private container: HTMLDivElement;
  private camera: Camera;
  private store: ElementStore;

  // Offscreen канвас с закешированными элементами в bufferCamera-системе координат.
  private bufferCanvas: HTMLCanvasElement | null = null;
  private bufferCamera: ICamera = { x: 0, y: 0, zoom: 1 };

  private dims = { width: 0, height: 0, dpr: 1 };

  private raf = 0;
  private rebuildRaf = 0;
  private trailRaf = 0;
  private resizeObserver: ResizeObserver;

  private worldEphemerals: Set<TWorldEphemeralDrawer> = new Set();
  private chromeDrawers: Set<TScreenEphemeralDrawer> = new Set();
  private screenEphemerals: Set<TScreenEphemeralDrawer> = new Set();

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLDivElement,
    camera: Camera,
    store: ElementStore,
  ) {
    this.canvas = canvas;
    this.container = container;
    this.camera = camera;
    this.store = store;
    this.updateDims();
    this.resizeObserver = new ResizeObserver(() => this.updateDims());
    this.resizeObserver.observe(container);
    this.rebuildBuffer();
    this.renderFrame();
  }

  // Освобождает все ресурсы и слушатели.
  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.rebuildRaf);
    cancelAnimationFrame(this.trailRaf);
    this.worldEphemerals.clear();
    this.chromeDrawers.clear();
    this.screenEphemerals.clear();
  }

  // Регистрирует рисователь в мировых координатах. Возвращает функцию отписки.
  addWorldDrawer(fn: TWorldEphemeralDrawer): () => void {
    this.worldEphemerals.add(fn);
    return () => this.worldEphemerals.delete(fn);
  }

  // Регистрирует рисователь chrome (выделение, ручки) поверх всего.
  addChromeDrawer(fn: TScreenEphemeralDrawer): () => void {
    this.chromeDrawers.add(fn);
    return () => this.chromeDrawers.delete(fn);
  }

  // Регистрирует рисователь в экранных координатах (поверх chrome).
  addScreenDrawer(fn: TScreenEphemeralDrawer): () => void {
    this.screenEphemerals.add(fn);
    return () => this.screenEphemerals.delete(fn);
  }

  // Полностью пересобирает offscreen buffer для текущей камеры.
  // Дорогая операция: проходит queryRect и рисует все попавшие элементы.
  rebuildBuffer(): void {
    const { width, height, dpr } = this.dims;
    if (width === 0 || height === 0) return;

    const pad = Math.round(PAD_CSS * dpr);
    const bufW = width + 2 * pad;
    const bufH = height + 2 * pad;

    if (!this.bufferCanvas) {
      this.bufferCanvas = document.createElement("canvas");
    }
    const buf = this.bufferCanvas;
    if (buf.width !== bufW || buf.height !== bufH) {
      buf.width = bufW;
      buf.height = bufH;
    }

    const ctx = buf.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, bufW, bufH);

    const { x, y, zoom } = this.camera;
    const vpW = width / dpr;
    const vpH = height / dpr;
    const worldMinX = (-x - PAD_CSS) / zoom;
    const worldMinY = (-y - PAD_CSS) / zoom;
    const worldMaxX = (vpW - x + PAD_CSS) / zoom;
    const worldMaxY = (vpH - y + PAD_CSS) / zoom;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(x + PAD_CSS, y + PAD_CSS);
    ctx.scale(zoom, zoom);
    for (const el of this.store.queryRect(
      worldMinX,
      worldMinY,
      worldMaxX,
      worldMaxY,
    )) {
      getHandler(el.type).draw(ctx, el, this.store);
    }
    ctx.restore();

    this.bufferCamera = this.camera.snapshot();
  }

  // Дорисовывает один элемент к существующему буферу в его системе координат.
  // Используется при добавлении элемента, чтобы избежать полной перестройки.
  addElementToBuffer(element: IElement): void {
    const buf = this.bufferCanvas;
    if (!buf || this.dims.width === 0) return;
    const ctx = buf.getContext("2d");
    if (!ctx) return;
    const { dpr } = this.dims;
    const { x, y, zoom } = this.bufferCamera;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(x + PAD_CSS, y + PAD_CSS);
    ctx.scale(zoom, zoom);
    getHandler(element.type).draw(ctx, element, this.store);
    ctx.restore();
  }

  // Устанавливает активный штрих карандаша (или null) и планирует перерисовку.
  setCurrentStroke(stroke: IStroke | null): void {
    this.currentStroke = stroke;
    this.scheduleRender();
  }

  // Добавляет точку в след ластика и поднимает анимацию затухания, если ещё не запущена.
  addEraserTrailPoint(point: IEraserTrailPoint): void {
    this.eraserTrail.push(point);
    this.startTrailLoop();
  }

  // Перерисовывает кадр на main canvas: buffer + все эфемерные слои.
  renderFrame(): void {
    const canvas = this.canvas;
    canvas.style.transform = "";
    const { width, height } = this.dims;
    if (width === 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    this.paintBuffer(ctx);
    this.paintCurrentStroke(ctx);
    this.paintEraserTrail(ctx);
    this.paintWorldEphemerals(ctx);
    this.paintScreenLayer(ctx, this.chromeDrawers);
    this.paintScreenLayer(ctx, this.screenEphemerals);
  }

  // Кладёт offscreen buffer на main canvas с компенсацией разницы камер.
  // Если zoom не менялся, рисуем со сдвигом без перестройки. Иначе — на месте,
  // полагаясь на то что scheduleBufferRebuild уже запланировал перестройку.
  private paintBuffer(ctx: CanvasRenderingContext2D): void {
    const buf = this.bufferCanvas;
    if (!buf || buf.width === 0) return;
    const cam = this.camera;
    const bufCam = this.bufferCamera;
    const pad = Math.round(PAD_CSS * this.dims.dpr);
    if (cam.zoom === bufCam.zoom) {
      ctx.drawImage(
        buf,
        (cam.x - bufCam.x) * this.dims.dpr - pad,
        (cam.y - bufCam.y) * this.dims.dpr - pad,
      );
    } else {
      ctx.drawImage(buf, -pad, -pad);
    }
  }

  // Рисует незавершённый штрих карандаша поверх buffer.
  private paintCurrentStroke(ctx: CanvasRenderingContext2D): void {
    if (!this.currentStroke) return;
    ctx.save();
    this.applyWorldTransform(ctx);
    drawStroke(ctx, this.currentStroke);
    ctx.restore();
  }

  // Рисует затухающий след ластика. Работает в экранных координатах (точки уже screen).
  private paintEraserTrail(ctx: CanvasRenderingContext2D): void {
    if (this.eraserTrail.length === 0) return;
    const now = Date.now();
    ctx.save();
    this.applyScreenTransform(ctx);
    for (const pt of this.eraserTrail) {
      const age = now - pt.t;
      const alpha =
        Math.max(0, 1 - age / ERASER_TRAIL_DURATION) * ERASER_TRAIL_ALPHA;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ERASER_TRAIL_COLOR;
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, ERASER_TRAIL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Прогоняет всех зарегистрированных world-рисователей (например preview коннектора).
  private paintWorldEphemerals(ctx: CanvasRenderingContext2D): void {
    if (this.worldEphemerals.size === 0) return;
    ctx.save();
    this.applyWorldTransform(ctx);
    for (const drawer of this.worldEphemerals) drawer(ctx);
    ctx.restore();
  }

  // Прогоняет рисователей в экранных координатах (chrome или screen-ephemerals).
  private paintScreenLayer(
    ctx: CanvasRenderingContext2D,
    layer: Set<TScreenEphemeralDrawer>,
  ): void {
    if (layer.size === 0) return;
    ctx.save();
    this.applyScreenTransform(ctx);
    for (const drawer of layer) drawer(ctx, this.camera);
    ctx.restore();
  }

  // Применяет к контексту трансформацию мировых координат: DPR + смещение + zoom камеры.
  // Без save/restore: caller отвечает за обёртку.
  private applyWorldTransform(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    ctx.scale(this.dims.dpr, this.dims.dpr);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);
  }

  // Применяет только DPR-масштаб (для рисования в экранных координатах).
  private applyScreenTransform(ctx: CanvasRenderingContext2D): void {
    ctx.scale(this.dims.dpr, this.dims.dpr);
  }

  // Планирует перерисовку при панорамировании. Если ушли далеко за пределы паддинга,
  // дополнительно перестраивает буфер (иначе откроются незакешированные области).
  schedulePanRender(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const cam = this.camera;
      const bufCam = this.bufferCamera;
      if (
        cam.zoom !== bufCam.zoom ||
        Math.abs(cam.x - bufCam.x) > PAD_CSS / 2 ||
        Math.abs(cam.y - bufCam.y) > PAD_CSS / 2
      ) {
        this.rebuildBuffer();
      }
      this.renderFrame();
    });
  }

  // Планирует только перерисовку кадра (buffer не трогаем).
  scheduleRender(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.renderFrame());
  }

  // Планирует пересборку буфера и перерисовку (например при изменении zoom).
  scheduleBufferRebuild(): void {
    cancelAnimationFrame(this.rebuildRaf);
    this.rebuildRaf = requestAnimationFrame(() => {
      this.rebuildBuffer();
      this.renderFrame();
    });
  }

  // Запускает цикл перерисовки следа ластика, пока есть живые точки.
  private startTrailLoop(): void {
    if (this.trailRaf) return;
    const tick = () => {
      const now = Date.now();
      this.eraserTrail = this.eraserTrail.filter(
        (pt) => now - pt.t < ERASER_TRAIL_DURATION,
      );
      this.renderFrame();
      if (this.eraserTrail.length > 0) {
        this.trailRaf = requestAnimationFrame(tick);
      } else {
        this.trailRaf = 0;
      }
    };
    this.trailRaf = requestAnimationFrame(tick);
  }

  // Считывает актуальные размеры контейнера в DPR-пикселях.
  // Сразу прокидывает CSS-размеры в камеру: ей нужен viewport для bounds-clamp и MIN_ZOOM.
  private updateDims(): void {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.container.getBoundingClientRect();
    this.dims = {
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
      dpr,
    };
    this.camera.setViewportSize(width, height);
  }
}
