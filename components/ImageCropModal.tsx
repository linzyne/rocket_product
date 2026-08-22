import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon, CropIcon } from './Icons';

interface ImageCropModalProps {
  isOpen: boolean;
  imageDataUrl: string | null;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
  // When cropping a batch of photos (see DetailPageBuilderModal's startCropQueue), these describe
  // this photo's position in the queue so the modal can show progress and relabel the apply button
  // ("다음 사진" mid-batch, final apply label on the last one) — undefined/1 for a single photo.
  queueIndex?: number;
  queueTotal?: number;
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

const ImageCropModal: React.FC<ImageCropModalProps> = ({ isOpen, imageDataUrl, onCancel, onApply, queueIndex = 0, queueTotal = 1 }) => {
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 100, h: 100 });
  const [aspect, setAspect] = useState<number | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; anchor: { x: number; y: number }; start: { x: number; y: number } } | null>(null);

  // Resets the crop box whenever a new photo is shown (either a fresh open, or — for a batch —
  // stepping to the next photo in the queue while the modal stays open). This runs during render
  // (the "adjusting state during render" pattern) rather than in a useEffect: a useEffect fires
  // *after* commit, but a cached/already-decoded data URL can fire the <img>'s load event
  // synchronously during that same commit, so an effect-based reset would race it and could clobber
  // the real naturalSize with stale zeros depending on timing.
  const [prevKey, setPrevKey] = useState({ isOpen, imageDataUrl });
  if (prevKey.isOpen !== isOpen || prevKey.imageDataUrl !== imageDataUrl) {
    setPrevKey({ isOpen, imageDataUrl });
    if (isOpen) {
      setNaturalSize({ width: 0, height: 0 });
      setRect({ x: 0, y: 0, w: 100, h: 100 });
      setAspect(null);
    }
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

  const applyAspect = (next: number | null) => {
    setAspect(next);
    if (next !== null && naturalSize.width && naturalSize.height) {
      setRect(prev => fitRectToAspect(prev, next, naturalSize));
    }
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

  const handleReset = () => {
    setAspect(null);
    setRect({ x: 0, y: 0, w: 100, h: 100 });
  };

  const handleApply = async () => {
    if (!imageDataUrl || !naturalSize.width || !naturalSize.height) return;
    setIsApplying(true);
    try {
      const img = await loadImage(imageDataUrl);
      const sx = Math.round((rect.x / 100) * naturalSize.width);
      const sy = Math.round((rect.y / 100) * naturalSize.height);
      const sw = Math.max(1, Math.round((rect.w / 100) * naturalSize.width));
      const sh = Math.max(1, Math.round((rect.h / 100) * naturalSize.height));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const isJpeg = imageDataUrl.startsWith('data:image/jpeg') || imageDataUrl.startsWith('data:image/jpg');
      const croppedDataUrl = isJpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
      onApply(croppedDataUrl);
    } catch (err) {
      console.error('이미지 자르기 실패:', err);
      alert('이미지를 자르는 중 오류가 발생했습니다.');
    } finally {
      setIsApplying(false);
    }
  };

  const isFullRect = useMemo(() => rect.x <= 0.1 && rect.y <= 0.1 && rect.w >= 99.9 && rect.h >= 99.9, [rect]);

  if (!isOpen || !imageDataUrl) return null;

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
        className="bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col max-h-[95vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <CropIcon className="text-purple-400 w-5 h-5" />
            사진 자르기
            {queueTotal > 1 && (
              <span className="text-sm font-normal text-purple-400 tabular-nums">
                ({queueIndex + 1}/{queueTotal})
              </span>
            )}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4 min-h-0">
          <div className="flex-1 min-h-[280px] max-h-[60vh] bg-slate-950/60 rounded-xl border border-slate-700 flex items-center justify-center p-4 overflow-auto">
            <div ref={wrapperRef} className="relative inline-block max-w-full max-h-[55vh] select-none touch-none">
              <img
                src={imageDataUrl}
                onLoad={handleImgLoad}
                alt="자를 이미지"
                className="block max-w-full max-h-[55vh] object-contain rounded-md pointer-events-none"
                draggable={false}
              />
              {naturalSize.width > 0 && (
                <>
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 flex-shrink-0">비율</span>
            {ASPECT_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => applyAspect(opt.value)}
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
              onClick={handleReset}
              disabled={isFullRect && aspect === null}
              className="ml-auto px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-md hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              초기화
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-700">
          <button onClick={onCancel} className="px-4 py-2 text-sm bg-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-600 transition-colors">
            {queueTotal > 1 ? '전체 취소' : '취소'}
          </button>
          <button
            onClick={handleApply}
            disabled={!naturalSize.width || isApplying}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CropIcon className="h-4 w-4" />
            {queueTotal > 1 ? (queueIndex < queueTotal - 1 ? '다음 사진 →' : '모두 적용') : '자르기 적용'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
