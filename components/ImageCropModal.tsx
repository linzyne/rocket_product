import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CloseIcon, CropIcon } from './Icons';

export interface CropSource {
  id: string;
  dataUrl: string;
}

interface ImageCropModalProps {
  isOpen: boolean;
  // Every photo to crop in this batch. A single-photo crop just passes a one-element array.
  // All photos are shown at once; the user sets a crop box on each, then one "자르기 적용" click
  // crops them all together and reports the results keyed by photo id.
  images: CropSource[] | null;
  onCancel: () => void;
  onApply: (results: Record<string, string>) => void;
}

interface Rect {
  x: number; // % of natural width
  y: number; // % of natural height
  w: number;
  h: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const ASPECT_OPTIONS: { label: string; value: number | null }[] = [
  { label: '자유', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const MIN_SIZE_PCT = 5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = src;
  });
}

// Crop rects are stored as % of the image's *natural* width/height, so a target pixel aspect
// ratio maps to different %-width vs %-height unless the source image happens to be square.
const heightPctForWidthPct = (widthPct: number, aspect: number, natural: { width: number; height: number }) =>
  ((widthPct / 100) * natural.width) / aspect / natural.height * 100;
const widthPctForHeightPct = (heightPct: number, aspect: number, natural: { width: number; height: number }) =>
  ((heightPct / 100) * natural.height) * aspect / natural.width * 100;

// Refits a rect to a target aspect ratio around its own center, shrinking as needed to stay in bounds.
function fitRectToAspect(rect: Rect, aspect: number, natural: { width: number; height: number }): Rect {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  let w = rect.w;
  let h = heightPctForWidthPct(w, aspect, natural);
  if (h > 100) {
    h = 100;
    w = widthPctForHeightPct(h, aspect, natural);
  }
  if (w > 100) {
    w = 100;
    h = heightPctForWidthPct(w, aspect, natural);
  }
  return {
    w,
    h,
    x: clamp(centerX - w / 2, 0, 100 - w),
    y: clamp(centerY - h / 2, 0, 100 - h),
  };
}

const HANDLES: { mode: DragMode; className: string; cursor: string }[] = [
  { mode: 'nw', className: 'top-0 left-0', cursor: 'nwse-resize' },
  { mode: 'ne', className: 'top-0 right-0', cursor: 'nesw-resize' },
  { mode: 'sw', className: 'bottom-0 left-0', cursor: 'nesw-resize' },
  { mode: 'se', className: 'bottom-0 right-0', cursor: 'nwse-resize' },
  { mode: 'n', className: 'top-0 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { mode: 's', className: 'bottom-0 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { mode: 'w', className: 'left-0 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { mode: 'e', className: 'right-0 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

// ---- 그리기 ----
// 자르기 창에서 사진 한 장을 크게 띄운 김에 그 위에 바로 칠할 수 있게 한다(중국어 지우기 등).
// 좌표는 화면 크기가 아니라 사진의 원본 픽셀로 들고 있어서, 어떤 크기로 보고 있든 결과가 같다.
export type CropDrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'arrow';

interface Point {
  x: number;
  y: number;
}

type DrawObject =
  | { type: 'brush'; points: Point[]; color: string; size: number }
  | { type: 'line' | 'rect' | 'ellipse' | 'arrow'; from: Point; to: Point; color: string; size: number };

export const CROP_DRAW_TOOLS: { tool: CropDrawTool; label: string }[] = [
  { tool: 'brush', label: '붓' },
  { tool: 'line', label: '선' },
  { tool: 'rect', label: '사각형' },
  { tool: 'ellipse', label: '원' },
  { tool: 'arrow', label: '화살표' },
];

const DRAW_COLORS = ['#ffffff', '#000000', '#ef4444', '#facc15', '#22c55e', '#3b82f6'];

// 상세페이지 에디터의 그리기와 같은 규칙: 사각형·원은 드래그한 자리를 속까지 채우고,
// 선·화살표·붓은 굵기만큼의 선으로 그린다.
const drawObjectOnCanvas = (ctx: CanvasRenderingContext2D, obj: DrawObject) => {
  ctx.strokeStyle = obj.color;
  ctx.fillStyle = obj.color;
  ctx.lineWidth = obj.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (obj.type === 'brush') {
    if (obj.points.length === 0) return;
    if (obj.points.length === 1) {
      const p = obj.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, obj.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) ctx.lineTo(obj.points[i].x, obj.points[i].y);
    ctx.stroke();
    return;
  }

  const { from, to } = obj;
  if (obj.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else if (obj.type === 'rect') {
    ctx.fillRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  } else if (obj.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((from.x + to.x) / 2, (from.y + to.y) / 2, Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (obj.type === 'arrow') {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = Math.max(10, obj.size * 2.5);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
};

const isFullRect = (rect: Rect) => rect.x <= 0.1 && rect.y <= 0.1 && rect.w >= 99.9 && rect.h >= 99.9;

export interface CropEditorHandle {
  // Returns the cropped data URL, or null when nothing was cropped (box left covering the whole
  // image, or the image never loaded) so the caller can leave that photo untouched.
  getResult: () => Promise<{ id: string; dataUrl: string } | null>;
}

interface CropEditorProps {
  source: CropSource;
  aspect: number | null;
  // Bumped by the parent's "초기화" button; each bump resets this editor's crop box to full frame.
  resetNonce: number;
  // true when several photos share the grid, so the editor renders at a smaller height.
  compact: boolean;
  // 'draw'면 자르기 상자 대신 그림판이 올라온다. 도구·굵기·색은 창 전체가 함께 쓴다.
  mode: 'crop' | 'draw';
  drawTool: CropDrawTool;
  drawColor: string;
  drawSize: number;
}

const CropEditor = forwardRef<CropEditorHandle, CropEditorProps>(({ source, aspect, resetNonce, compact, mode, drawTool, drawColor, drawSize }, ref) => {
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 100, h: 100 });
  // 이 사진 위에 그린 것들. 사진의 원본 픽셀 좌표로 들고 있다가 적용할 때 사진에 구워 넣는다.
  const [drawObjects, setDrawObjects] = useState<DrawObject[]>([]);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<{ from: Point; points: Point[] } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; anchor: { x: number; y: number }; start: { x: number; y: number } } | null>(null);

  // Refit the box when the shared aspect ratio changes (runs during render — see the note in the
  // parent — so a synchronously-decoded image can't race an effect-based refit).
  const [prevAspect, setPrevAspect] = useState<number | null>(aspect);
  if (prevAspect !== aspect) {
    setPrevAspect(aspect);
    if (aspect !== null && naturalSize.width && naturalSize.height) {
      setRect(prev => fitRectToAspect(prev, aspect, naturalSize));
    }
  }

  const [prevReset, setPrevReset] = useState(resetNonce);
  if (prevReset !== resetNonce) {
    setPrevReset(resetNonce);
    setRect({ x: 0, y: 0, w: 100, h: 100 });
    setDrawObjects([]);
  }

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const getPointPct = (clientX: number, clientY: number) => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: clamp(((clientX - r.left) / r.width) * 100, 0, 100),
      y: clamp(((clientY - r.top) / r.height) * 100, 0, 100),
    };
  };

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const point = getPointPct(e.clientX, e.clientY);
    let anchor = { x: rect.x, y: rect.y };
    if (mode === 'nw') anchor = { x: rect.x + rect.w, y: rect.y + rect.h };
    else if (mode === 'ne') anchor = { x: rect.x, y: rect.y + rect.h };
    else if (mode === 'sw') anchor = { x: rect.x + rect.w, y: rect.y };
    else if (mode === 'se') anchor = { x: rect.x, y: rect.y };
    else if (mode === 'n') anchor = { x: rect.x, y: rect.y + rect.h };
    else if (mode === 's') anchor = { x: rect.x, y: rect.y };
    else if (mode === 'w') anchor = { x: rect.x + rect.w, y: rect.y };
    else if (mode === 'e') anchor = { x: rect.x, y: rect.y };
    dragRef.current = { mode, anchor, start: point };
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !naturalSize.width || !naturalSize.height) return;
      const point = getPointPct(e.clientX, e.clientY);

      if (drag.mode === 'move') {
        setRect(prev => ({
          ...prev,
          x: clamp(drag.anchor.x + (point.x - drag.start.x), 0, 100 - prev.w),
          y: clamp(drag.anchor.y + (point.y - drag.start.y), 0, 100 - prev.h),
        }));
        return;
      }

      const anchor = drag.anchor;
      const isCorner = drag.mode === 'nw' || drag.mode === 'ne' || drag.mode === 'sw' || drag.mode === 'se';
      const affectsX = isCorner || drag.mode === 'e' || drag.mode === 'w';
      const affectsY = isCorner || drag.mode === 'n' || drag.mode === 's';

      let w = affectsX ? Math.abs(point.x - anchor.x) : rect.w;
      let h = affectsY ? Math.abs(point.y - anchor.y) : rect.h;

      if (aspect !== null) {
        // Corner handles: derive height from width. Edge handles: derive the other axis
        // from whichever axis this handle actually drags, so the box still tracks the pointer.
        if (affectsX && (isCorner || !affectsY)) {
          h = heightPctForWidthPct(w, aspect, naturalSize);
        } else {
          w = widthPctForHeightPct(h, aspect, naturalSize);
        }
      }

      w = Math.max(MIN_SIZE_PCT, w);
      h = Math.max(MIN_SIZE_PCT, h);

      // Clamp so the box never runs past the image edge; when locked to an aspect ratio,
      // clamping one axis must shrink the other to keep the ratio intact.
      const maxW = point.x >= anchor.x ? 100 - anchor.x : anchor.x;
      const maxH = point.y >= anchor.y ? 100 - anchor.y : anchor.y;
      if (w > maxW) {
        w = maxW;
        if (aspect !== null) h = heightPctForWidthPct(w, aspect, naturalSize);
      }
      if (h > maxH) {
        h = maxH;
        if (aspect !== null) w = widthPctForHeightPct(h, aspect, naturalSize);
      }

      const x = point.x >= anchor.x ? anchor.x : anchor.x - w;
      const y = point.y >= anchor.y ? anchor.y : anchor.y - h;

      setRect({
        x: clamp(x, 0, 100 - w),
        y: clamp(y, 0, 100 - h),
        w,
        h,
      });
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, naturalSize, rect.w, rect.h]);

  // 화면에 보이는 그림. 캔버스를 사진 원본 크기로 두고 CSS로 줄여 보여주므로, 좌표 변환 없이
  // 원본 픽셀 그대로 그리면 된다(적용할 때도 이 좌표를 그대로 쓴다).
  const redraw = (preview?: DrawObject) => {
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawObjects.forEach(obj => drawObjectOnCanvas(ctx, obj));
    if (preview) drawObjectOnCanvas(ctx, preview);
  };

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawObjects, naturalSize]);

  const pointOnImage = (e: React.PointerEvent): Point => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * naturalSize.width,
      y: ((e.clientY - r.top) / r.height) * naturalSize.height,
    };
  };

  const handleDrawDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw' || !naturalSize.width) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = pointOnImage(e);
    strokeRef.current = { from: point, points: [point] };
    if (drawTool === 'brush') redraw({ type: 'brush', points: [point], color: drawColor, size: drawSize });
  };

  const handleDrawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const point = pointOnImage(e);
    if (drawTool === 'brush') {
      stroke.points.push(point);
      redraw({ type: 'brush', points: stroke.points, color: drawColor, size: drawSize });
    } else {
      redraw({ type: drawTool, from: stroke.from, to: point, color: drawColor, size: drawSize });
    }
  };

  const handleDrawUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    const point = pointOnImage(e);
    if (drawTool === 'brush') {
      if (stroke.points.length > 0) {
        setDrawObjects(prev => [...prev, { type: 'brush', points: stroke.points, color: drawColor, size: drawSize }]);
      }
      return;
    }
    // 점만 찍고 끝난 경우(실수 클릭)는 도형으로 치지 않는다.
    if (Math.abs(point.x - stroke.from.x) < 2 && Math.abs(point.y - stroke.from.y) < 2) {
      redraw();
      return;
    }
    setDrawObjects(prev => [...prev, { type: drawTool, from: stroke.from, to: point, color: drawColor, size: drawSize }]);
  };

  useImperativeHandle(
    ref,
    () => ({
      getResult: async () => {
        // 자르지도 않고 그리지도 않았으면 이 사진은 그대로 둔다.
        if (!naturalSize.width || !naturalSize.height || (isFullRect(rect) && drawObjects.length === 0)) return null;
        const img = await loadImage(source.dataUrl);

        // 그린 것을 사진에 먼저 구워 넣고, 그다음 자른다.
        const full = document.createElement('canvas');
        full.width = naturalSize.width;
        full.height = naturalSize.height;
        const fullCtx = full.getContext('2d')!;
        fullCtx.drawImage(img, 0, 0);
        drawObjects.forEach(obj => drawObjectOnCanvas(fullCtx, obj));

        const sx = Math.round((rect.x / 100) * naturalSize.width);
        const sy = Math.round((rect.y / 100) * naturalSize.height);
        const sw = Math.max(1, Math.round((rect.w / 100) * naturalSize.width));
        const sh = Math.max(1, Math.round((rect.h / 100) * naturalSize.height));
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
        const isJpeg = source.dataUrl.startsWith('data:image/jpeg') || source.dataUrl.startsWith('data:image/jpg');
        const croppedDataUrl = isJpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
        return { id: source.id, dataUrl: croppedDataUrl };
      },
    }),
    [naturalSize, rect, source, drawObjects],
  );

  const imgClass = compact ? 'max-w-full max-h-[280px]' : 'max-w-full max-h-[55vh]';

  return (
    <div
      className={`bg-slate-950/60 rounded-xl border border-slate-700 flex items-center justify-center p-3 overflow-auto ${
        compact ? 'min-h-[200px]' : 'min-h-[280px] flex-1'
      }`}
    >
      <div ref={wrapperRef} className="relative inline-block max-w-full select-none touch-none">
        <img
          src={source.dataUrl}
          onLoad={handleImgLoad}
          alt="자를 이미지"
          className={`block object-contain rounded-md pointer-events-none ${imgClass}`}
          draggable={false}
        />
        {naturalSize.width > 0 && mode === 'draw' && (
          <>
            <canvas
              ref={drawCanvasRef}
              width={naturalSize.width}
              height={naturalSize.height}
              className="absolute inset-0 w-full h-full"
              style={{ cursor: 'crosshair', touchAction: 'none' }}
              onPointerDown={handleDrawDown}
              onPointerMove={handleDrawMove}
              onPointerUp={handleDrawUp}
              onPointerCancel={handleDrawUp}
            />
            {drawObjects.length > 0 && (
              <div className="absolute top-2 right-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => setDrawObjects(prev => prev.slice(0, -1))}
                  className="px-2 py-1 text-[11px] rounded-md bg-slate-900/80 text-slate-200 hover:bg-slate-800"
                >
                  되돌리기
                </button>
                <button
                  type="button"
                  onClick={() => setDrawObjects([])}
                  className="px-2 py-1 text-[11px] rounded-md bg-slate-900/80 text-slate-200 hover:bg-slate-800"
                >
                  전부 지우기
                </button>
              </div>
            )}
          </>
        )}
        {naturalSize.width > 0 && mode === 'crop' && (
          <>
            {/* 그리기 모드에서 그린 것은 자르기 모드에서도 그대로 보여준다(어디를 지웠는지 보고 자르게). */}
            <canvas
              ref={drawCanvasRef}
              width={naturalSize.width}
              height={naturalSize.height}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {/* Dim everything outside the crop rect */}
            <div
              className="absolute inset-0 bg-black/55 pointer-events-none"
              style={{
                clipPath: `polygon(0% 0%, 0% 100%, ${rect.x}% 100%, ${rect.x}% ${rect.y}%, ${rect.x + rect.w}% ${rect.y}%, ${rect.x + rect.w}% ${rect.y + rect.h}%, ${rect.x}% ${rect.y + rect.h}%, ${rect.x}% 100%, 100% 100%, 100% 0%)`,
              }}
            />
            <div
              onPointerDown={beginDrag('move')}
              className="absolute border-2 border-purple-400 cursor-move"
              style={{
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.w}%`,
                height: `${rect.h}%`,
                boxShadow: '0 0 0 9999px transparent',
              }}
            >
              {/* Rule-of-thirds guide lines */}
              <div className="absolute inset-0 pointer-events-none opacity-60">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/50" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/50" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/50" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/50" />
              </div>
              {HANDLES.map(h => (
                <div
                  key={h.mode}
                  onPointerDown={beginDrag(h.mode)}
                  className={`absolute w-3.5 h-3.5 bg-purple-400 border-2 border-white rounded-full -m-1.5 ${h.className}`}
                  style={{ cursor: h.cursor }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

CropEditor.displayName = 'CropEditor';

const ImageCropModal: React.FC<ImageCropModalProps> = ({ isOpen, images, onCancel, onApply }) => {
  const [aspect, setAspect] = useState<number | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  // 자르기 창에서 바로 칠할 수 있게 한 모드. 도구·굵기·색은 이 창의 모든 사진이 함께 쓴다.
  const [mode, setMode] = useState<'crop' | 'draw'>('crop');
  const [drawTool, setDrawTool] = useState<CropDrawTool>('brush');
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawSize, setDrawSize] = useState(24);
  const [isApplying, setIsApplying] = useState(false);
  const editorsRef = useRef<Record<string, CropEditorHandle | null>>({});

  const list = useMemo(() => images ?? [], [images]);

  // Reset the shared controls each time the modal opens (see ImageCropModal in the single-photo
  // days — the crop box reset lives per-editor now, keyed off `resetNonce`).
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setAspect(null);
      setResetNonce(n => n + 1);
      setMode('crop');
    }
  }

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const results: Record<string, string> = {};
      for (const item of list) {
        const r = await editorsRef.current[item.id]?.getResult();
        if (r) results[r.id] = r.dataUrl;
      }
      onApply(results);
    } catch (err) {
      console.error('이미지 자르기 실패:', err);
      alert('이미지를 자르는 중 오류가 발생했습니다.');
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen || list.length === 0) return null;

  const multi = list.length > 1;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-85 flex justify-center items-center z-[80] p-4"
      onClick={e => {
        // Stop here so this backdrop click doesn't bubble into DetailPageBuilderModal's own
        // backdrop handler (this modal is rendered nested inside it, not as a sibling portal).
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className={`bg-slate-900 rounded-2xl shadow-2xl w-full flex flex-col max-h-[95vh] overflow-hidden ${
          multi ? 'max-w-5xl' : 'max-w-3xl'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <CropIcon className="text-purple-400 w-5 h-5" />
            사진 자르기
            {multi && <span className="text-sm font-normal text-purple-400 tabular-nums">({list.length}장)</span>}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              {([['crop', '✂ 자르기'], ['draw', '✏ 그리기']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mode === value ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4 min-h-0">
          {multi && (
            <p className="text-xs text-slate-400">
              각 사진에서 자를 영역을 지정한 뒤 아래 <span className="text-slate-200 font-semibold">자르기 적용</span>을
              한 번 누르면 모든 사진이 한꺼번에 잘립니다. 영역을 건드리지 않은 사진은 그대로 유지됩니다.
            </p>
          )}
          <div className={multi ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'flex flex-col flex-1 min-h-0'}>
            {list.map(item => (
              <CropEditor
                key={item.id}
                ref={el => {
                  editorsRef.current[item.id] = el;
                }}
                source={item}
                aspect={aspect}
                resetNonce={resetNonce}
                compact={multi}
                mode={mode}
                drawTool={drawTool}
                drawColor={drawColor}
                drawSize={drawSize}
              />
            ))}
          </div>

          {mode === 'draw' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400 flex-shrink-0">도구</span>
              {CROP_DRAW_TOOLS.map(({ tool, label }) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => setDrawTool(tool)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    drawTool === tool
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-slate-400 ml-2">굵기</span>
              <input
                type="range"
                min={2}
                max={120}
                value={drawSize}
                onChange={e => setDrawSize(Number(e.target.value))}
                className="w-28 accent-purple-500"
                title="붓·선·화살표의 굵기 (사각형·원은 채우므로 굵기와 무관합니다)"
              />
              <span className="text-xs text-slate-400 ml-2">색상</span>
              {DRAW_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setDrawColor(color)}
                  className={`w-6 h-6 rounded-md border-2 ${drawColor === color ? 'border-purple-400' : 'border-slate-600'}`}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
              <input
                type="color"
                value={drawColor}
                onChange={e => setDrawColor(e.target.value)}
                className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                title="색 직접 고르기"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {mode === 'crop' && <span className="text-xs text-slate-400 flex-shrink-0">비율{multi ? ' (전체 적용)' : ''}</span>}
            {mode === 'crop' && ASPECT_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => setAspect(opt.value)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  aspect === opt.value
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => {
                setAspect(null);
                setResetNonce(n => n + 1);
              }}
              className="ml-auto px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-md hover:bg-slate-600 transition-colors"
            >
              전체 초기화
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-700">
          <button onClick={onCancel} className="px-4 py-2 text-sm bg-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-600 transition-colors">
            취소
          </button>
          <button
            onClick={handleApply}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CropIcon className="h-4 w-4" />
            {isApplying ? '적용 중…' : multi ? `${list.length}장 적용` : '적용하기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
