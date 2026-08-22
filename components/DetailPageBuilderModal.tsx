import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Product } from '../types';
import {
  buildDetailPageCopyPrompt,
  parseDetailPageCopyText,
  DetailPageCopy,
  DEFAULT_HIGHLIGHT_COUNT,
  HIGHLIGHT_COUNT_MIN,
  HIGHLIGHT_COUNT_MAX,
  DEFAULT_FEATURE_BLOCK_COUNT,
  FEATURE_BLOCK_COUNT_MIN,
  FEATURE_BLOCK_COUNT_MAX,
} from '../utils/detailPageCopyTemplate';
import { CloseIcon, SpinnerIcon, SaveIcon, DownloadIcon, SparklesIcon, UploadIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon, BrushIcon, PlusIcon, StarIcon, CropIcon, CheckIcon, EyedropperIcon, UndoIcon, LineIcon, SquareIcon, CircleIcon, ArrowIcon } from './Icons';
import { editImageWithGemini, BRUSH_ERASE_PROMPT } from '../utils/geminiImageEdit';
import { generateDetailPageCopyWithGemini } from '../utils/detailPageCopyGemini';
import { saveDataUrlInProductFolder, productFolderName } from '../utils/fileSave';
import { generateId } from '../utils/id';
import ImageCropModal from './ImageCropModal';

declare var html2canvas: any;

interface DetailPageBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  // 같은 URL을 공유하는 옵션(색상 등) 전체. product 하나만 있으면(옵션이 없는 상품) 이 배열도
  // product 하나만 담는다. 상세페이지는 이 그룹 전체에 동일하게 저장되고, 대표이미지만
  // 옵션(=배열의 각 항목)별로 다르게 지정할 수 있다.
  groupProducts: Product[];
  onSave: (field: 'thumbnailDataUrl' | 'detailDataUrl' | 'detailFile', value: string) => void;
  // 업로드한 사진 중 하나를 특정 옵션(productId)의 대표이미지(thumbnailFile, 자동 이름
  // "{순번}s.png")로 지정한다. 모달을 닫지 않는다 — 대표이미지 지정은 상세페이지를 계속
  // 조립하는 중에 곁들여 하는 부수 동작이라, 전체를 마무리짓는 onSave('detailDataUrl', ...)
  // (모달을 닫는다, App.tsx의 handleSave 참고)과는 다르다.
  onSaveThumbnail: (productId: string, dataUrl: string) => void;
}

interface PhotoItem {
  id: string;
  dataUrl: string;
}

// Free-draw layer: brush strokes are freehand point paths, the rest are drag-defined shapes
// (from → to, in the same drawCanvas coordinate space as points). All persist as vector data (not
// baked into a bitmap) so they can be redrawn whenever the canvas is resized — see redrawDrawObjects.
type DrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'arrow';
type DrawObject =
  | { type: 'brush'; points: { x: number; y: number }[]; color: string; size: number }
  | { type: 'line' | 'rect' | 'ellipse' | 'arrow'; from: { x: number; y: number }; to: { x: number; y: number }; color: string; size: number };

// Design width the whole preview is authored at (matches the reference detail page's proportions,
// see scratchpad measurement notes) — html2canvas captures this DOM 1:1 (scaled up) for export.
const CANVAS_WIDTH = 860;
// 저장 파일 용량 제한(거래처 업로드 기준) — 초과 시 captureImage가 2x 오버샘플링 해상도를
// 실제 표시 배율(1x, CANVAS_WIDTH) 선까지만 단계적으로 낮춰서 화질 저하 없이 용량을 줄인다.
const MAX_DETAIL_IMAGE_BYTES = 10 * 1024 * 1024;
const PADDING_X = 65;
const RULE_COLOR = '#d9d9d9';
const CARD_COLOR = '#f2f2f2';
const PRODUCT_INFO_LABEL_COLUMN = 180;
// Consistent vertical-rhythm scale used for every block's spacing below.
const SPACE = { xs: 10, sm: 18, md: 28, lg: 45, xl: 60 };
// Extra breathing room between distinct sections (hero / highlights / each feature / closing / product info).
const SECTION_GAP = 70;
// Numbered feature blocks (01~0N) that share the uploaded photos left over after the fixed
// hero/closing slots — see distributePhotos below. Count is user-adjustable (see featureBlockCount).

// Fonts already loaded in index.html (Pretendard/Paperlogy via jsdelivr, the rest via Google Fonts).
const FONT_OPTIONS = [
  { label: 'Paperlogy (기본)', value: 'Paperlogy' },
  { label: 'Pretendard', value: 'Pretendard' },
  { label: 'Noto Sans KR', value: 'Noto Sans KR' },
  { label: 'Black Han Sans', value: 'Black Han Sans' },
  { label: 'Jua', value: 'Jua' },
];

interface TemplateStyleSettings {
  fontFamily: string;
  textColor: string;
  fontScale: number; // multiplier applied to every text block's base font size
}

const DEFAULT_TEMPLATE_STYLE: TemplateStyleSettings = {
  fontFamily: 'Paperlogy',
  textColor: '#1a1a1a',
  fontScale: 1,
};

// Splits `items` into `groupCount` roughly equal chunks, front-loading the remainder so earlier
// groups get one extra item first (e.g. 4 items / 3 groups → [2, 1, 1]).
function distributeEvenly<T>(items: T[], groupCount: number): T[][] {
  const base = Math.floor(items.length / groupCount);
  const remainder = items.length % groupCount;
  const groups: T[][] = [];
  let idx = 0;
  for (let g = 0; g < groupCount; g++) {
    const count = base + (g < remainder ? 1 : 0);
    groups.push(items.slice(idx, idx + count));
    idx += count;
  }
  return groups;
}

const EMPTY_COPY: DetailPageCopy = {
  productName: '',
  hookCopy: '',
  highlights: [],
  features: [],
  closing: '',
};

// AI 문구생성 스타일 지침을 이름 붙여 저장해두는 프롬프트 라이브러리 — 상품과 무관하게 앱
// 전체에서 공유(카테고리 목록과 같은 방식, App.tsx의 categories 참고)한다.
interface SavedCopyPrompt {
  id: string;
  name: string;
  instruction: string;
}

const COPY_PROMPTS_STORAGE_KEY = 'detailPageCopyPrompts';

function loadSavedCopyPrompts(): SavedCopyPrompt[] {
  try {
    const raw = localStorage.getItem(COPY_PROMPTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load detail page copy prompts from localStorage', error);
    return [];
  }
}

// Base font sizes (at fontScale 1) for every text role — see the `styles` useMemo in the component,
// which turns these into the actual React.CSSProperties objects once fontFamily/textColor/fontScale
// (all user-adjustable) are known.
const BASE_FONT_SIZE = {
  heroTitle: 66,
  heroSubtitle: 50,
  sectionHeading: 55,
  highlight: 34,
  featureNumber: 89,
  featureTitle: 62,
  featureDesc: 46,
  closingTitle: 55,
  productInfo: 46,
};

interface EditableTextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style: React.CSSProperties;
}

// Click-to-edit text block used throughout the live preview. Mirrors the contentEditable +
// commit-on-blur pattern from ImageEditorModal's TextLayer (components/ImageEditorModal.tsx),
// simplified since these blocks don't need drag-to-reposition — just click and type.
const EditableText: React.FC<EditableTextProps> = ({ value, onChange, placeholder, style }) => {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setFocused(true)}
        onBlur={e => {
          setFocused(false);
          onChange(e.currentTarget.innerText.replace(/\n+$/, ''));
        }}
        style={{ ...style, outline: 'none', whiteSpace: 'pre-wrap', cursor: 'text', minHeight: '1.2em' }}
      >
        {value}
      </div>
      {!focused && !value.trim() && (
        <div data-html2canvas-ignore="true" style={{ ...style, position: 'absolute', inset: 0, color: '#94a3b8', pointerEvents: 'none' }}>
          {placeholder}
        </div>
      )}
    </div>
  );
};

const DetailPageBuilderModal: React.FC<DetailPageBuilderModalProps> = ({ isOpen, onClose, product, groupProducts, onSave, onSaveThumbnail }) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [sellingPoints, setSellingPoints] = useState('');
  const [copy, setCopy] = useState<DetailPageCopy>(EMPTY_COPY);
  const [isExporting, setIsExporting] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [promptCopyStatus, setPromptCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [zoom, setZoom] = useState(1);

  // AI 문구생성: 저장된 프롬프트(이름 + 스타일 지침) 목록과 현재 선택/편집 중인 지침.
  // savedPrompts는 상품과 무관하게 앱 전체에서 공유되고, promptInstruction은 선택한 프롬프트를
  // 불러온 값이거나 저장 없이 즉석에서 쓰는 값이다.
  const [savedPrompts, setSavedPrompts] = useState<SavedCopyPrompt[]>(loadSavedCopyPrompts);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [promptInstruction, setPromptInstruction] = useState('');
  const [copyGenStatus, setCopyGenStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [copyGenError, setCopyGenError] = useState('');
  // Template-level settings (not per-product): shared across every product's detail page so the
  // whole shop keeps one consistent look. highlightCount controls how many "특별한점" cards render.
  const [templateStyle, setTemplateStyle] = useState<TemplateStyleSettings>(DEFAULT_TEMPLATE_STYLE);
  const [highlightCount, setHighlightCount] = useState(DEFAULT_HIGHLIGHT_COUNT);
  const [featureBlockCount, setFeatureBlockCount] = useState(DEFAULT_FEATURE_BLOCK_COUNT);

  // Brush-erase flow: paint over any photo(s) in the assembled detail page, then "텍스트 삭제" sends
  // just the photo(s) the brush touched through Gemini — one call per affected photo, each at its own
  // native resolution — and replaces that photo's dataUrl with the result. See handleEraseFullPage.
  const [brushMode, setBrushMode] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [brushCursorPos, setBrushCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [hasPainted, setHasPainted] = useState(false);
  const [eraseStatus, setEraseStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [eraseError, setEraseError] = useState('');

  // Free-draw flow: paint colored strokes/shapes directly onto the assembled detail page. Unlike the
  // erase-brush mask above, these persist as an overlay layer (survives leaving draw mode, gets baked
  // in on save/download via html2canvas) — see the drawCanvas effects and handleDraw* below.
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>('brush');
  const [drawColor, setDrawColor] = useState('#ff3b30');
  const [drawSize, setDrawSize] = useState(6);
  const [drawCursorPos, setDrawCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [drawObjects, setDrawObjects] = useState<DrawObject[]>([]);
  const eyedropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;

  // Photos queued for cropping — a single click on one photo queues just that one; the toolbar's
  // "선택한 사진 크롭" button queues every checked photo instead. The modal steps through the queue
  // one photo at a time; nothing is written back to `photos` until the *last* one is applied, so
  // "적용하기" on a multi-photo batch commits every crop in the batch at once (see handleApplyCrop).
  // Cancelling at any point discards the whole in-progress batch, not just the current photo.
  const [cropQueue, setCropQueue] = useState<PhotoItem[]>([]);
  const [cropQueueIndex, setCropQueueIndex] = useState(0);
  const cropResultsRef = useRef<Record<string, string>>({});
  const cropTarget = cropQueue[cropQueueIndex] ?? null;

  // Photos checked via the selection checkbox overlay in the preview, for batch-cropping together.
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());

  // 옵션이 여러 개일 때(groupProducts.length > 1) 별 아이콘을 누르면 "이 사진을 어느 옵션의
  // 대표이미지로 쓸지" 고르는 작은 드롭다운을 연다. 옵션이 1개뿐이면 드롭다운 없이 바로 지정한다.
  const [thumbnailAssignPhotoId, setThumbnailAssignPhotoId] = useState<string | null>(null);
  const thumbnailAssignMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!thumbnailAssignPhotoId) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (thumbnailAssignMenuRef.current && !thumbnailAssignMenuRef.current.contains(event.target as Node)) {
        setThumbnailAssignPhotoId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [thumbnailAssignPhotoId]);

  const previewRef = useRef<HTMLDivElement>(null);
  const draggedPhotoIdRef = useRef<string | null>(null);
  const [draggingPhotoId, setDraggingPhotoId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement>(null);
  const isPaintingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // Tracks the bounding box (in brush-canvas coordinate space) of everything painted so far, so the
  // erase call can crop down to just that region instead of sending the whole (potentially huge)
  // flattened page through Gemini — see handleEraseFullPage.
  const paintedBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  // Guarded synchronously (not via React state) so a double-click or key repeat while the request is
  // in flight can't slip a second Gemini call through before the `eraseStatus === 'loading'`
  // re-render lands — this is what keeps one click to exactly one charge.
  const eraseProcessingRef = useRef(false);

  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  // Brush: previous point of the current stroke, to draw the next incremental segment from. Shapes:
  // the latest cursor position, read back on pointer-up to know where the drag ended.
  const lastDrawPointerRef = useRef<{ x: number; y: number } | null>(null);
  const currentStrokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  // Mirrors `drawObjects` for read access inside the ResizeObserver callback below, which is set up
  // once and would otherwise close over a stale (empty) array.
  const drawObjectsRef = useRef<DrawObject[]>([]);

  // Fixed photo slots: first photo = hero, last photo = closing (right above 마무리 문구).
  // Everything in between is split as evenly as possible across the featureBlockCount
  // numbered feature sections (01~0N), each of which can now hold more than one photo.
  // Selected photos in display order (Set has no inherent order), so a batch crop steps through
  // them top-to-bottom regardless of the order they were checked in.
  const selectedPhotosOrdered = photos.filter(p => selectedPhotoIds.has(p.id));
  const heroPhoto = photos[0];
  const closingPhoto = photos.length >= 2 ? photos[photos.length - 1] : undefined;
  const middlePhotos: PhotoItem[] = photos.length >= 2 ? photos.slice(1, photos.length - 1) : [];
  const featurePhotoGroups = distributeEvenly(middlePhotos, featureBlockCount);

  // Before any 문구 has been generated/pasted in, the preview should read as "photos only" —
  // no placeholder text blocks cluttering the layout while just arranging photos. Once copy has
  // any content (from 문구생성하기, 붙여넣은 문구 적용, or direct edits after that point), every
  // text block (including empty placeholders for any still-blank fields) shows again as usual.
  const hasCopyText =
    copy.productName.trim() !== '' || copy.hookCopy.trim() !== '' ||
    copy.highlights.some(h => h.trim() !== '') ||
    copy.features.some(f => f.title.trim() !== '' || f.description.trim() !== '') ||
    copy.closing.trim() !== '';

  // This modal is kept mounted for the whole session (see App.tsx) specifically so in-progress
  // work survives closing it — closing must not wipe state. Drafts are kept per product id here
  // so switching products doesn't leak one product's photos/copy into another's.
  const draftsRef = useRef<Map<string, { photos: PhotoItem[]; sellingPoints: string; copy: DetailPageCopy; pastedText: string; drawObjects: DrawObject[] }>>(new Map());
  const activeProductIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextId = product?.id ?? null;
    const prevId = activeProductIdRef.current;
    if (prevId && prevId !== nextId) {
      draftsRef.current.set(prevId, { photos, sellingPoints, copy, pastedText, drawObjects });
    }
    if (nextId && nextId !== prevId) {
      const draft = draftsRef.current.get(nextId);
      setPhotos(draft?.photos ?? []);
      setSellingPoints(draft?.sellingPoints ?? '');
      setCopy(draft?.copy ?? EMPTY_COPY);
      setPastedText(draft?.pastedText ?? '');
      setDrawObjects(draft?.drawObjects ?? []);
    }
    activeProductIdRef.current = nextId;
    setBrushMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setEraseStatus('idle');
    setEraseError('');
    setDrawMode(false);
    // Only react to the product actually changing — reopening the same product must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  useEffect(() => {
    if (!isOpen) return;
    setPromptCopyStatus('idle');
    setZoom(1);
    setBrushMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setEraseStatus('idle');
    setEraseError('');
    setDrawMode(false);
  }, [isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(COPY_PROMPTS_STORAGE_KEY, JSON.stringify(savedPrompts));
    } catch (error) {
      console.error('Failed to save detail page copy prompts to localStorage', error);
    }
  }, [savedPrompts]);

  // Brush mode needs 1:1 screen-to-canvas coordinates, so force zoom to 100% while it's active (same
  // reason captureImage/captureCanvas reset zoom before capturing) and size the paint canvas to match
  // the unscaled preview once that layout settles.
  useEffect(() => {
    if (!brushMode) return;
    if (zoom !== 1) {
      setZoom(1);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const canvas = brushCanvasRef.current;
      const preview = previewRef.current;
      if (canvas && preview) {
        canvas.width = preview.scrollWidth;
        canvas.height = preview.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [brushMode, zoom]);

  // Draw mode needs the same 1:1 screen-to-canvas coordinates as brush mode.
  useEffect(() => {
    if (!drawMode) return;
    if (zoom !== 1) setZoom(1);
  }, [drawMode, zoom]);

  // Renders one draw object (freehand stroke or drag-defined shape) onto a 2D context.
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
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      ctx.strokeRect(x, y, Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    } else if (obj.type === 'ellipse') {
      const cx = (from.x + to.x) / 2;
      const cy = (from.y + to.y) / 2;
      const rx = Math.abs(to.x - from.x) / 2;
      const ry = Math.abs(to.y - from.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
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

  const redrawDrawObjects = (objects: DrawObject[]) => {
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    objects.forEach(obj => drawObjectOnCanvas(ctx, obj));
  };

  // Bakes committed draw objects onto the canvas whenever the list changes (stroke/shape finished,
  // undo, clear).
  useEffect(() => {
    drawObjectsRef.current = drawObjects;
    redrawDrawObjects(drawObjects);
  }, [drawObjects]);

  // The draw canvas lives inside previewRef so html2canvas captures it, but previewRef's height
  // changes with content (photo count, copy length, template settings) — a naive canvas resize would
  // wipe the bitmap, so instead every resize just re-renders the persisted vector data from scratch.
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    const preview = previewRef.current;
    if (!canvas || !preview || photos.length === 0) return;
    const syncSize = () => {
      const w = preview.scrollWidth;
      const h = preview.scrollHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        redrawDrawObjects(drawObjectsRef.current);
      }
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [photos.length]);

  const zoomIn = () => setZoom(z => Math.min(2, Math.round((z + 0.1) * 100) / 100));
  const zoomOut = () => setZoom(z => Math.max(0.4, Math.round((z - 0.1) * 100) / 100));

  const material = product?.customFields?.['소재'];

  const productInfoRows = useMemo(() => {
    if (!product) return [];
    const size = [product.sizeWidth, product.sizeHeight, product.sizeDepth].filter(Boolean).join(' x ');
    const rows: { label: string; value: string }[] = [
      { label: '제품명', value: product.productName },
      { label: '소재', value: material || '' },
      { label: '제조국', value: product.countryOfOrigin },
      { label: '수입사', value: product.importer },
      { label: '사이즈', value: size },
      { label: '무게', value: product.weight ? `${product.weight}g` : '' },
      { label: '사용연령', value: product.recommendedAge },
      { label: 'A/S', value: product.asContact },
    ];
    return rows.filter(r => r.value && r.value.trim());
  }, [product, material]);

  // Turns the user-adjustable font/color/size settings into the actual per-role style objects used
  // below, so every text block in the preview reacts live to the "템플릿 스타일" controls.
  const styles = useMemo(() => {
    const { fontFamily, textColor, fontScale } = templateStyle;
    const size = (base: number) => Math.round(base * fontScale);
    const base = (fontSize: number): React.CSSProperties => ({ fontFamily, fontSize, color: textColor });
    return {
      heroTitle: { ...base(size(BASE_FONT_SIZE.heroTitle)), fontWeight: 700, lineHeight: 1.35, textAlign: 'center', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      heroSubtitle: { ...base(size(BASE_FONT_SIZE.heroSubtitle)), fontWeight: 700, lineHeight: 1.6, textAlign: 'center', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      sectionHeading: { ...base(size(BASE_FONT_SIZE.sectionHeading)), fontWeight: 700, textAlign: 'center' } as React.CSSProperties,
      highlight: { ...base(size(BASE_FONT_SIZE.highlight)), fontWeight: 400, lineHeight: 1.6, textAlign: 'center' } as React.CSSProperties,
      featureNumber: { ...base(size(BASE_FONT_SIZE.featureNumber)), fontWeight: 700, textAlign: 'left', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      featureTitle: { ...base(size(BASE_FONT_SIZE.featureTitle)), fontWeight: 700, lineHeight: 1.3, textAlign: 'left', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      featureDesc: { ...base(size(BASE_FONT_SIZE.featureDesc)), fontWeight: 400, lineHeight: 1.6, textAlign: 'left', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      closingTitle: { ...base(size(BASE_FONT_SIZE.closingTitle)), fontWeight: 700, lineHeight: 1.4, textAlign: 'center', padding: `0 ${PADDING_X}px` } as React.CSSProperties,
      productInfo: base(size(BASE_FONT_SIZE.productInfo)),
    };
  }, [templateStyle]);

  if (!isOpen) return null;

  const addPhotoFiles = (files: File[]) => {
    files.forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setPhotos(prev => [...prev, { id: generateId(), dataUrl: reader.result as string }]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPhotoFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  // Lets the "+" tile act as a paste target: click to focus it, then Ctrl/Cmd+V an image copied to
  // the clipboard (screenshot, copied image from a browser, etc.) to add it straight to the photo list.
  const handlePastePhoto = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((item: DataTransferItem) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item: DataTransferItem) => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return;
    e.preventDefault();
    addPhotoFiles(files);
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
    setSelectedPhotoIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // 옵션이 1개뿐이면 바로 그 옵션에 지정하고, 여러 개면 별 아이콘 클릭 시 어느 옵션에 지정할지
  // 고르는 드롭다운을 연다(옵션 목록은 groupProducts, 실제 지정은 handleAssignThumbnailToOption).
  const handleStarClick = (photo: PhotoItem) => {
    if (groupProducts.length <= 1) {
      const targetId = groupProducts[0]?.id ?? product?.id;
      if (targetId) onSaveThumbnail(targetId, photo.dataUrl);
      return;
    }
    setThumbnailAssignPhotoId(prev => (prev === photo.id ? null : photo.id));
  };

  const handleAssignThumbnailToOption = (photo: PhotoItem, productId: string) => {
    onSaveThumbnail(productId, photo.dataUrl);
    setThumbnailAssignPhotoId(null);
  };

  const startCropQueue = (targets: PhotoItem[]) => {
    if (targets.length === 0) return;
    cropResultsRef.current = {};
    setCropQueueIndex(0);
    setCropQueue(targets);
  };

  const cancelCropQueue = () => {
    cropResultsRef.current = {};
    setCropQueue([]);
    setCropQueueIndex(0);
  };

  const handleApplyCrop = (croppedDataUrl: string) => {
    if (!cropTarget) return;
    cropResultsRef.current[cropTarget.id] = croppedDataUrl;
    if (cropQueueIndex < cropQueue.length - 1) {
      setCropQueueIndex(i => i + 1);
      return;
    }
    // Last (or only) photo in the batch — commit every queued crop to `photos` in one update.
    const results = cropResultsRef.current;
    setPhotos(prev => prev.map(p => (results[p.id] ? { ...p, dataUrl: results[p.id] } : p)));
    setSelectedPhotoIds(new Set());
    cancelCropQueue();
  };

  const togglePhotoSelected = (id: string) => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBrushMode = () => {
    setDrawMode(false);
    setBrushMode(prev => {
      const next = !prev;
      // Leaving brush mode unmounts the canvas (its painted pixels go with it), so drop the
      // "something is painted" flag too — otherwise re-entering with a blank canvas would still
      // leave "텍스트 삭제" enabled and fire a wasted (empty-mask) API call.
      if (!next) {
        setHasPainted(false);
        paintedBoundsRef.current = null;
      }
      return next;
    });
  };

  const toggleDrawMode = () => {
    setBrushMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setDrawMode(prev => !prev);
  };

  const getPointOnCanvas = (canvas: HTMLCanvasElement, e: React.PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const drawMaskSegment = (canvas: HTMLCanvasElement, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = 'rgba(255, 0, 230, 0.65)';
    ctx.fillStyle = 'rgba(255, 0, 230, 0.65)';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(from.x, from.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    const r = brushSize / 2;
    const b = paintedBoundsRef.current;
    const minX = Math.min(from.x, to.x) - r;
    const minY = Math.min(from.y, to.y) - r;
    const maxX = Math.max(from.x, to.x) + r;
    const maxY = Math.max(from.y, to.y) + r;
    paintedBoundsRef.current = b
      ? { minX: Math.min(b.minX, minX), minY: Math.min(b.minY, minY), maxX: Math.max(b.maxX, maxX), maxY: Math.max(b.maxY, maxY) }
      : { minX, minY, maxX, maxY };
  };

  const handleBrushPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (eraseStatus === 'loading') return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    isPaintingRef.current = true;
    const point = getPointOnCanvas(canvas, e);
    lastPointRef.current = point;
    setBrushCursorPos(point);
    drawMaskSegment(canvas, point, point);
    setHasPainted(true);
  };

  const handleBrushPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const point = getPointOnCanvas(canvas, e);
    setBrushCursorPos(point);
    if (!isPaintingRef.current || !lastPointRef.current) return;
    drawMaskSegment(canvas, lastPointRef.current, point);
    lastPointRef.current = point;
  };

  const handleBrushPointerUp = () => {
    isPaintingRef.current = false;
    lastPointRef.current = null;
  };

  const handleBrushPointerLeave = () => {
    handleBrushPointerUp();
    setBrushCursorPos(null);
  };

  const handleClearMask = () => {
    const canvas = brushCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasPainted(false);
    paintedBoundsRef.current = null;
  };

  // Brush: draws each segment incrementally as the pointer moves, then commits the full point path to
  // `drawObjects` on pointer-up. Shapes: redraws everything committed so far plus a live from→to
  // preview of the shape being dragged, then commits just the final from→to on pointer-up.
  const handleDrawPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const point = getPointOnCanvas(canvas, e);
    setDrawCursorPos(point);
    isDrawingRef.current = true;
    lastDrawPointerRef.current = point;
    if (drawTool === 'brush') {
      currentStrokePointsRef.current = [point];
      const ctx = canvas.getContext('2d');
      if (ctx) drawObjectOnCanvas(ctx, { type: 'brush', points: [point], color: drawColor, size: drawSize });
    } else {
      shapeStartRef.current = point;
    }
  };

  const handleDrawPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const point = getPointOnCanvas(canvas, e);
    setDrawCursorPos(point);
    if (!isDrawingRef.current) return;
    const ctx = canvas.getContext('2d');
    if (drawTool === 'brush') {
      if (lastDrawPointerRef.current && ctx) {
        drawObjectOnCanvas(ctx, { type: 'brush', points: [lastDrawPointerRef.current, point], color: drawColor, size: drawSize });
        currentStrokePointsRef.current.push(point);
      }
    } else if (shapeStartRef.current && ctx) {
      redrawDrawObjects(drawObjects);
      drawObjectOnCanvas(ctx, { type: drawTool, from: shapeStartRef.current, to: point, color: drawColor, size: drawSize });
    }
    lastDrawPointerRef.current = point;
  };

  const handleDrawPointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (drawTool === 'brush') {
      const points = currentStrokePointsRef.current;
      currentStrokePointsRef.current = [];
      if (points.length > 0) setDrawObjects(prev => [...prev, { type: 'brush', points, color: drawColor, size: drawSize }]);
    } else if (shapeStartRef.current) {
      const start = shapeStartRef.current;
      const end = lastDrawPointerRef.current;
      shapeStartRef.current = null;
      if (end && (Math.abs(end.x - start.x) > 2 || Math.abs(end.y - start.y) > 2)) {
        setDrawObjects(prev => [...prev, { type: drawTool, from: start, to: end, color: drawColor, size: drawSize }]);
      } else {
        redrawDrawObjects(drawObjects);
      }
    }
    lastDrawPointerRef.current = null;
  };

  const handleDrawPointerLeave = () => {
    handleDrawPointerUp();
    setDrawCursorPos(null);
  };

  const handleUndoDraw = () => setDrawObjects(prev => prev.slice(0, -1));
  const handleClearDraw = () => setDrawObjects([]);

  // Native browser eyedropper (Chrome/Edge) — samples a color from anywhere on screen, including the
  // photos in the preview, not just a preset palette.
  const handleEyedropper = async () => {
    if (!eyedropperSupported) return;
    try {
      const eyeDropper = new (window as any).EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) setDrawColor(result.sRGBHex);
    } catch {
      // 사용자가 Esc 등으로 취소한 경우 — 무시.
    }
  };

  // Shared by both the download/save path and the erase path: reset zoom to 100% (html2canvas can
  // pick up the CSS zoom transform otherwise), wait for the font + layout to settle, then flatten the
  // whole live preview (photos + all text) into one canvas via html2canvas.
  const captureCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!previewRef.current || photos.length === 0) return null;
    const previousZoom = zoom;
    try {
      if (previousZoom !== 1) {
        setZoom(1);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      await Promise.all([
        document.fonts.load('700 89px "Paperlogy"').catch(() => undefined),
        document.fonts.load('400 46px "Paperlogy"').catch(() => undefined),
      ]);
      // previewRef sits inside a scrollable panel; without explicit width/height html2canvas
      // only captures the currently-scrolled-into-view slice instead of the full page.
      const fullWidth = previewRef.current.scrollWidth;
      const fullHeight = previewRef.current.scrollHeight;
      return await html2canvas(previewRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        ignoreElements: (el: Element) => el.hasAttribute('data-html2canvas-ignore'),
      });
    } finally {
      if (previousZoom !== 1) setZoom(previousZoom);
    }
  };

  // base64 데이터 URL의 실제 바이트 크기를 인코딩 오버헤드/패딩까지 감안해 계산한다.
  const dataUrlByteSize = (dataUrl: string): number => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor(base64.length * 0.75) - padding;
  };

  // source를 scale 배율로 리샘플링한 새 캔버스를 반환한다 (원본은 변경하지 않음).
  const downscaleCanvas = (source: HTMLCanvasElement, scale: number): HTMLCanvasElement => {
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(source.width * scale));
    target.height = Math.max(1, Math.round(source.height * scale));
    const ctx = target.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
    return target;
  };

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
      img.src = src;
    });

  // Sends only the individual photo(s) the brush touched through Gemini — never the whole flattened
  // page. Each affected photo goes through at its own original resolution (normal aspect ratio, not
  // an extreme tall strip) and its returned edit *replaces that photo entirely*. Replacing the whole
  // photo — instead of pasting a partial crop back into a bigger canvas — is what actually removes
  // the misalignment risk: there's no seam where a cropped edit could land slightly off, because
  // nothing gets spliced into a larger image. This also means the flattened page is never touched, so
  // no quality loss from oversized-image downscaling either.
  const handleEraseFullPage = async () => {
    if (eraseProcessingRef.current || eraseStatus === 'loading' || !hasPainted || !brushCanvasRef.current || !previewRef.current) return;
    eraseProcessingRef.current = true;
    setEraseStatus('loading');
    setEraseError('');
    try {
      const brushCanvas = brushCanvasRef.current;
      const bounds = paintedBoundsRef.current;
      if (!bounds) throw new Error('칠한 영역이 없습니다.');

      const previewRect = previewRef.current.getBoundingClientRect();
      const photoEls = Array.from(previewRef.current.querySelectorAll<HTMLImageElement>('img[data-photo-id]'));

      const affected = photoEls
        .map((el: HTMLImageElement) => {
          const rect = el.getBoundingClientRect();
          return {
            photoId: el.getAttribute('data-photo-id')!,
            relLeft: rect.left - previewRect.left,
            relTop: rect.top - previewRect.top,
            relWidth: rect.width,
            relHeight: rect.height,
          };
        })
        .filter(r =>
          r.relLeft < bounds.maxX && r.relLeft + r.relWidth > bounds.minX &&
          r.relTop < bounds.maxY && r.relTop + r.relHeight > bounds.minY,
        );

      if (affected.length === 0) throw new Error('칠한 영역에 사진이 없습니다. 사진 위를 칠해주세요.');

      const results = await Promise.all(affected.map(async ({ photoId, relLeft, relTop, relWidth, relHeight }) => {
        const photo = photos.find(p => p.id === photoId);
        if (!photo) return null;
        const img = await loadImage(photo.dataUrl);

        const photoCanvas = document.createElement('canvas');
        photoCanvas.width = img.naturalWidth;
        photoCanvas.height = img.naturalHeight;
        const photoCtx = photoCanvas.getContext('2d')!;
        photoCtx.drawImage(img, 0, 0);
        // Map the brush canvas's on-screen region for this photo onto the photo's native resolution.
        photoCtx.drawImage(
          brushCanvas,
          relLeft, relTop, relWidth, relHeight,
          0, 0, photoCanvas.width, photoCanvas.height,
        );

        const editedDataUrl = await editImageWithGemini(photoCanvas.toDataURL('image/png'), BRUSH_ERASE_PROMPT);
        return { photoId, editedDataUrl };
      }));

      setPhotos(prev => prev.map(p => {
        const updated = results.find(r => r?.photoId === p.id);
        return updated ? { ...p, dataUrl: updated.editedDataUrl } : p;
      }));
      setBrushMode(false);
      setHasPainted(false);
      paintedBoundsRef.current = null;
      setEraseStatus('idle');
    } catch (err) {
      console.error('상세페이지 텍스트 지우기 실패:', err);
      const detail = err instanceof Error ? err.message : String(err);
      setEraseError(`AI 지우기 중 오류가 발생했습니다: ${detail}`);
      setEraseStatus('error');
    } finally {
      eraseProcessingRef.current = false;
    }
  };

  const movePhoto = (id: string, dir: -1 | 1) => {
    setPhotos(prev => {
      const idx = prev.findIndex(p => p.id === id);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // Reordering uses Pointer Events (not native HTML5 drag-and-drop): the preview sits inside a
  // `transform: scale(zoom)` wrapper for the zoom control, and Chrome's native drag/drop hit-testing
  // tracks the cursor against the unscaled layout under a transformed ancestor — so at any zoom other
  // than exactly 100% the drop target it resolves is offset from where the photo actually is, and the
  // reorder silently never applies. Pointer Events + elementFromPoint aren't affected by that.
  const reorderPhotos = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setPhotos(prev => {
      const next = [...prev];
      const fromIdx = next.findIndex(p => p.id === draggedId);
      if (fromIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      const toIdx = next.findIndex(p => p.id === targetId);
      next.splice(toIdx === -1 ? next.length : toIdx, 0, moved);
      return next;
    });
  };

  const handlePhotoPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (brushMode || drawMode || e.button !== 0) return;
    // Let the crop/move/star buttons layered on top of the photo handle their own clicks.
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggedPhotoIdRef.current = id;
    setDraggingPhotoId(id);
  };

  const handlePhotoPointerMove = (e: React.PointerEvent) => {
    if (!draggedPhotoIdRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const targetEl = el?.closest<HTMLElement>('[data-photo-id]');
    setDragOverPhotoId(targetEl?.dataset.photoId ?? null);
  };

  const endPhotoDrag = () => {
    const draggedId = draggedPhotoIdRef.current;
    const targetId = dragOverPhotoId;
    draggedPhotoIdRef.current = null;
    setDraggingPhotoId(null);
    setDragOverPhotoId(null);
    if (draggedId && targetId) reorderPhotos(draggedId, targetId);
  };

  const handlePhotoPointerUp = () => endPhotoDrag();
  const handlePhotoPointerCancel = () => endPhotoDrag();

  const renderPhoto = (photo: PhotoItem, marginBottom: number) => (
    <div key={photo.id} style={{ position: 'relative', marginBottom }}>
      <img
        data-photo-id={photo.id}
        src={photo.dataUrl}
        draggable={false}
        onPointerDown={handlePhotoPointerDown(photo.id)}
        onPointerMove={handlePhotoPointerMove}
        onPointerUp={handlePhotoPointerUp}
        onPointerCancel={handlePhotoPointerCancel}
        onClick={() => {
          // A stationary pointerdown+up (no drag) still fires a plain click — safe to share the
          // same image with drag-to-reorder.
          if (!brushMode && !drawMode) startCropQueue([photo]);
        }}
        style={{
          width: '100%',
          display: 'block',
          cursor: brushMode || drawMode ? 'default' : 'grab',
          opacity: draggingPhotoId === photo.id ? 0.4 : 1,
          touchAction: brushMode || drawMode ? undefined : 'none',
          outline: selectedPhotoIds.has(photo.id)
            ? '2px solid #a855f7'
            : dragOverPhotoId === photo.id && draggingPhotoId && draggingPhotoId !== photo.id ? '2px solid #3b82f6' : 'none',
          outlineOffset: -2,
        }}
        alt=""
      />
      {!brushMode && !drawMode && (
        <button
          data-html2canvas-ignore="true"
          onClick={() => togglePhotoSelected(photo.id)}
          className={`absolute top-2.5 left-2.5 w-6 h-6 flex items-center justify-center rounded-md border-2 transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5 ${
            selectedPhotoIds.has(photo.id)
              ? 'bg-purple-600 border-purple-400 text-white'
              : 'bg-slate-900/60 border-white/70 text-transparent hover:border-purple-400'
          }`}
          title="크롭할 사진으로 선택"
        >
          <CheckIcon />
        </button>
      )}
      {!brushMode && !drawMode && (
        <div data-html2canvas-ignore="true" className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <button
            onClick={() => startCropQueue([photo])}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-purple-500/90 transition-colors [&_svg]:h-4 [&_svg]:w-4"
            title="사진 자르기"
          >
            <CropIcon />
          </button>
          <button
            onClick={() => movePhoto(photo.id, -1)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-slate-700 transition-colors [&_svg]:h-4 [&_svg]:w-4"
            title="위로 이동"
          >
            <ChevronUpIcon />
          </button>
          <button
            onClick={() => movePhoto(photo.id, 1)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-slate-700 transition-colors [&_svg]:h-4 [&_svg]:w-4"
            title="아래로 이동"
          >
            <ChevronDownIcon />
          </button>
          <button
            onClick={() => removePhoto(photo.id)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-red-500/90 transition-colors [&_svg]:h-4 [&_svg]:w-4"
            title="사진 삭제"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );

  const handleSelectPrompt = (id: string) => {
    setSelectedPromptId(id);
    setPromptInstruction(savedPrompts.find(p => p.id === id)?.instruction ?? '');
  };

  const handleSaveCurrentPrompt = () => {
    const trimmed = promptInstruction.trim();
    if (!trimmed) return;
    const existing = savedPrompts.find(p => p.id === selectedPromptId);
    const name = window.prompt('이 프롬프트의 이름을 입력해주세요.', existing?.name ?? '');
    if (!name || !name.trim()) return;
    if (existing) {
      setSavedPrompts(prev => prev.map(p => (p.id === existing.id ? { ...p, name: name.trim(), instruction: trimmed } : p)));
    } else {
      const id = generateId();
      setSavedPrompts(prev => [...prev, { id, name: name.trim(), instruction: trimmed }]);
      setSelectedPromptId(id);
    }
  };

  const handleDeleteSelectedPrompt = () => {
    const target = savedPrompts.find(p => p.id === selectedPromptId);
    if (!target) return;
    if (!window.confirm(`"${target.name}" 프롬프트를 삭제할까요?`)) return;
    setSavedPrompts(prev => prev.filter(p => p.id !== target.id));
    setSelectedPromptId('');
    setPromptInstruction('');
  };

  const handleGenerateCopy = async () => {
    if (!product) return;
    setCopyGenStatus('loading');
    setCopyGenError('');
    try {
      const result = await generateDetailPageCopyWithGemini(
        { productName: product.productName, category: product.category, material, sellingPoints },
        highlightCount,
        featureBlockCount,
        promptInstruction.trim() || undefined,
      );
      setCopy(result);
      setCopyGenStatus('idle');
    } catch (err) {
      console.error('문구 생성 실패:', err);
      setCopyGenError(err instanceof Error ? err.message : '문구 생성에 실패했어요.');
      setCopyGenStatus('error');
    }
  };

  const handleCopyPrompt = async () => {
    if (!product) return;
    const prompt = buildDetailPageCopyPrompt({
      productName: product.productName,
      category: product.category,
      material,
      sellingPoints,
    }, highlightCount, featureBlockCount);
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopyStatus('copied');
      setTimeout(() => setPromptCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('프롬프트 복사 실패:', err);
      alert('클립보드 복사에 실패했어요. 아래 텍스트를 직접 선택해서 복사해주세요.');
    }
  };

  const handleApplyPasted = () => {
    if (!pastedText.trim()) return;
    const result = parseDetailPageCopyText(pastedText, highlightCount, featureBlockCount);
    const hasAnyContent =
      result.productName || result.hookCopy ||
      result.highlights.some(h => h.trim()) || result.features.length > 0 || result.closing;
    if (!hasAnyContent) {
      alert('붙여넣은 텍스트에서 문구를 찾지 못했어요. 형식이 맞는지 확인해주세요.');
      return;
    }
    // AI 답변이 요청한 라벨 형식과 조금만 달라도 그 항목만 통째로 빈칸이 된다(다른 항목은 정상
    // 인식되니 "찾지 못했어요" 경고는 안 뜬다) — 저장 후에야 빈칸을 발견하는 일이 없도록, 어떤
    // 항목이 비게 되는지 미리 알려주고 그래도 적용할지 확인한다.
    const missingParts: string[] = [];
    if (!result.productName.trim()) missingParts.push('제품명');
    if (!result.hookCopy.trim()) missingParts.push('후킹 문구');
    if (!result.highlights.some(h => h.trim())) missingParts.push('특별한점');
    if (result.features.length === 0) missingParts.push('특징(01~)');
    if (!result.closing.trim()) missingParts.push('마무리 문구');
    if (missingParts.length > 0) {
      const proceed = window.confirm(
        `다음 항목을 찾지 못해 비어 있게 적용돼요: ${missingParts.join(', ')}\n` +
        'AI 답변의 라벨이 요청한 형식과 조금 다르면 이런 일이 생길 수 있어요. 그래도 적용할까요?\n' +
        '(적용 후 빈 칸은 직접 입력하거나, 텍스트를 손봐서 다시 적용해보세요)'
      );
      if (!proceed) return;
    }
    setCopy(result);
  };

  const updateHighlight = (idx: number, value: string) => {
    setCopy(prev => {
      const highlights = [...prev.highlights];
      highlights[idx] = value;
      return { ...prev, highlights };
    });
  };

  const updateFeatureField = (number: string, field: 'title' | 'description', value: string) => {
    setCopy(prev => {
      const existing = prev.features.find(f => f.number === number) || { number, title: '', description: '' };
      const updated = { ...existing, [field]: value };
      const features = prev.features.filter(f => f.number !== number);
      if (updated.title.trim() || updated.description.trim()) features.push(updated);
      features.sort((a, b) => a.number.localeCompare(b.number));
      return { ...prev, features };
    });
  };

  const captureImage = async (): Promise<string | null> => {
    setIsExporting(true);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return null;

      let dataUrl = canvas.toDataURL('image/png');
      // 1) 2x로 캡처된 원본에서 시작해, 용량 제한을 넘으면 실제 표시 배율(1x)까지만 10%씩
      // 다운스케일한다(PNG, 무손실). 1x 밑으로는 내리지 않으므로 화면에 보이는 해상도보다
      // 흐려지는 일은 없다.
      const minScale = CANVAS_WIDTH / canvas.width;
      let scale = 1;
      while (dataUrlByteSize(dataUrl) > MAX_DETAIL_IMAGE_BYTES && scale > minScale) {
        scale = Math.max(minScale, scale * 0.9);
        dataUrl = downscaleCanvas(canvas, scale).toDataURL('image/png');
      }

      // 2) 사진이 많아 1x PNG로도 용량을 못 맞추면 JPEG로 전환해 품질을 단계적으로 낮춘다.
      // 0.95~0.6 구간은 육안상 차이가 거의 없으면서 PNG보다 훨씬 작아, 여기서 대부분 해결된다.
      // 그래도 못 맞추면 최저 품질을 유지한 채 해상도를 추가로 낮춰가며 재시도한다.
      if (dataUrlByteSize(dataUrl) > MAX_DETAIL_IMAGE_BYTES) {
        const qualitySteps = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6];
        let jpegScale = minScale;
        findFit: while (true) {
          const scaledCanvas = downscaleCanvas(canvas, jpegScale);
          for (const quality of qualitySteps) {
            dataUrl = scaledCanvas.toDataURL('image/jpeg', quality);
            if (dataUrlByteSize(dataUrl) <= MAX_DETAIL_IMAGE_BYTES) break findFit;
          }
          if (jpegScale <= 0.15) break;
          jpegScale *= 0.85;
        }
      }

      if (dataUrlByteSize(dataUrl) > MAX_DETAIL_IMAGE_BYTES) {
        const limitMb = Math.round(MAX_DETAIL_IMAGE_BYTES / (1024 * 1024));
        alert(`사진 수가 많아 이미지 용량을 ${limitMb}MB 이하로 줄이지 못했습니다. 사진 수를 줄이거나 나눠서 저장해주세요.`);
      }

      return dataUrl;
    } catch (err) {
      console.error('상세페이지 캡처 실패:', err);
      alert('상세페이지 이미지를 만드는 중 오류가 발생했습니다.');
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  // 용량 때문에 JPEG로 대체된 경우(captureImage 참고) 파일명 확장자도 맞춰준다 — 내용은 JPEG인데
  // 이름만 .png로 남으면 마켓 업로드 시 문제가 될 수 있다.
  const fileNameForDataUrl = (dataUrl: string, fallbackName: string): string =>
    dataUrl.startsWith('data:image/jpeg') ? fallbackName.replace(/\.png$/i, '.jpg') : fallbackName;

  // 붙여넣기 파싱이 실패했거나(라벨 형식이 조금 달라서) 문구를 하나도 입력하지 않은 채로 그대로
  // 저장/다운로드해버리는 걸 막는 마지막 안전장치 — 문구가 전부 빈칸이면 저장 직전에 한 번 확인한다.
  const confirmIfCopyEmpty = () => {
    const isEmpty =
      !copy.productName.trim() && !copy.hookCopy.trim() &&
      copy.highlights.every(h => !h.trim()) && copy.features.length === 0 && !copy.closing.trim();
    if (!isEmpty) return true;
    return window.confirm('제품명/후킹 문구/특별한점/특징/마무리 문구가 전부 비어 있어요. 이대로 저장할까요?');
  };

  const handleDownload = async () => {
    if (!confirmIfCopyEmpty()) return;
    const dataUrl = await captureImage();
    if (!dataUrl) return;
    const baseName = product?.detailFile || `${product?.productName || 'detail_page'}.png`;
    await saveDataUrlInProductFolder(dataUrl, productFolderName(product), fileNameForDataUrl(dataUrl, baseName));
  };

  const handleSave = async () => {
    if (!confirmIfCopyEmpty()) return;
    const dataUrl = await captureImage();
    if (!dataUrl) return;
    if (product?.detailFile) {
      const fileName = fileNameForDataUrl(dataUrl, product.detailFile);
      if (fileName !== product.detailFile) onSave('detailFile', fileName);
    }
    onSave('detailDataUrl', dataUrl);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[70] p-4" onClick={onClose}>
      <div
        className="bg-slate-900 rounded-2xl shadow-2xl max-w-6xl w-full flex flex-col max-h-[95vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <SparklesIcon className="text-purple-400 w-5 h-5" />
            상세페이지 만들기{product ? ` · ${product.productName || '상품'}` : ''}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col lg:flex-row gap-5 min-h-0">
          {/* Live preview / editor */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
            {photos.length > 0 && (
              <div className="flex items-center justify-between gap-1.5 flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={toggleBrushMode}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-xs font-semibold transition-colors ${
                      brushMode
                        ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-500'
                        : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <BrushIcon className="h-3.5 w-3.5" />
                    {brushMode ? '브러쉬 모드 종료' : '브러쉬로 텍스트 지우기'}
                  </button>
                  <button
                    onClick={toggleDrawMode}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-xs font-semibold transition-colors ${
                      drawMode
                        ? 'bg-pink-600 border-pink-500 text-white hover:bg-pink-500'
                        : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <BrushIcon className="h-3.5 w-3.5" />
                    {drawMode ? '그리기 모드 종료' : '브러쉬/도형으로 칠하기'}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {selectedPhotosOrdered.length > 0 && !brushMode && !drawMode && (
                    <>
                      <button
                        onClick={() => startCropQueue(selectedPhotosOrdered)}
                        className="flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-xs font-semibold bg-purple-600 border-purple-500 text-white hover:bg-purple-500 transition-colors"
                      >
                        <CropIcon className="h-3.5 w-3.5" />
                        선택한 사진 크롭 ({selectedPhotosOrdered.length})
                      </button>
                      <button
                        onClick={() => setSelectedPhotoIds(new Set())}
                        className="px-2 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors text-xs"
                      >
                        선택 해제
                      </button>
                    </>
                  )}
                  <button
                    onClick={zoomOut}
                    disabled={zoom <= 0.4 || brushMode || drawMode}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                    title="축소"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setZoom(1)}
                    disabled={brushMode || drawMode}
                    className="px-2 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors text-xs tabular-nums disabled:opacity-30 disabled:cursor-not-allowed"
                    title="100%로 초기화"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    onClick={zoomIn}
                    disabled={zoom >= 2 || brushMode || drawMode}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                    title="확대"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {brushMode && (
              <div className="flex-shrink-0 flex flex-col gap-2 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  지우고 싶은 텍스트 위를 브러쉬로 칠하세요 (사진 여러 장에 걸쳐도 괜찮아요). "텍스트 삭제"를 누르면{' '}
                  <strong className="text-slate-200">브러쉬가 닿은 사진만 원본 화질 그대로 Gemini로 자연스럽게 지워요</strong> (사진을 합치지 않아서 화질 저하가 없어요).
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-14 flex-shrink-0">브러쉬 크기</span>
                  <input
                    type="range"
                    min={10}
                    max={150}
                    value={brushSize}
                    onChange={e => setBrushSize(Number(e.target.value))}
                    disabled={eraseStatus === 'loading'}
                    className="flex-1"
                  />
                  <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{brushSize}</span>
                </div>
                {eraseStatus === 'error' && <p className="text-red-400 text-xs">{eraseError}</p>}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={handleClearMask}
                    disabled={!hasPainted || eraseStatus === 'loading'}
                    className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    마스크 지우기
                  </button>
                  <button
                    onClick={handleEraseFullPage}
                    disabled={!hasPainted || eraseStatus === 'loading'}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {eraseStatus === 'loading' ? <SpinnerIcon className="w-3.5 h-3.5 animate-spin" /> : <SparklesIcon className="h-3.5 w-3.5" />}
                    {eraseStatus === 'loading' ? '사진에서 지우는 중...' : '텍스트 삭제'}
                  </button>
                </div>
              </div>
            )}

            {drawMode && (
              <div className="flex-shrink-0 flex flex-col gap-2 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  원하는 도구·굵기·색상으로 상세페이지 위에 자유롭게 칠하거나 도형을 그리세요. 그려진 내용은 저장/다운로드 시 그대로 포함돼요.
                </p>
                <div className="flex items-center gap-1.5">
                  {([
                    { tool: 'brush' as DrawTool, label: '브러쉬', Icon: BrushIcon },
                    { tool: 'line' as DrawTool, label: '직선', Icon: LineIcon },
                    { tool: 'rect' as DrawTool, label: '사각형', Icon: SquareIcon },
                    { tool: 'ellipse' as DrawTool, label: '원', Icon: CircleIcon },
                    { tool: 'arrow' as DrawTool, label: '화살표', Icon: ArrowIcon },
                  ]).map(({ tool, label, Icon }) => (
                    <button
                      key={tool}
                      onClick={() => setDrawTool(tool)}
                      title={label}
                      className={`w-8 h-8 flex items-center justify-center rounded-md border transition-colors [&_svg]:h-4 [&_svg]:w-4 ${
                        drawTool === tool
                          ? 'bg-pink-600 border-pink-500 text-white'
                          : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
                      }`}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-14 flex-shrink-0">굵기</span>
                  <input
                    type="range"
                    min={1}
                    max={40}
                    value={drawSize}
                    onChange={e => setDrawSize(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{drawSize}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">색상</span>
                    <input
                      type="color"
                      value={drawColor}
                      onChange={e => setDrawColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                      title="색상 선택"
                    />
                    <button
                      onClick={handleEyedropper}
                      disabled={!eyedropperSupported}
                      className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed [&_svg]:h-4 [&_svg]:w-4"
                      title={eyedropperSupported ? '스포이드로 화면에서 색상 추출' : '이 브라우저는 스포이드 기능을 지원하지 않아요'}
                    >
                      <EyedropperIcon />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleUndoDraw}
                      disabled={drawObjects.length === 0}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5"
                    >
                      <UndoIcon />
                      되돌리기
                    </button>
                    <button
                      onClick={handleClearDraw}
                      disabled={drawObjects.length === 0}
                      className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      전체 지우기
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0 bg-slate-950/60 rounded-xl border border-slate-700 p-4 min-h-[320px] max-h-[70vh] overflow-auto flex justify-center items-start">
            {photos.length === 0 ? null : (
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
              <div ref={previewRef} style={{ width: CANVAS_WIDTH, backgroundColor: '#ffffff', position: 'relative' }}>
                {/* Hero */}
                {hasCopyText && (
                  <>
                    <div style={{ marginTop: SPACE.lg, marginBottom: SPACE.sm }}>
                      <EditableText value={copy.productName} onChange={v => setCopy(prev => ({ ...prev, productName: v }))} placeholder="제품명" style={styles.heroTitle} />
                    </div>
                    <div style={{ marginBottom: SPACE.lg }}>
                      <EditableText value={copy.hookCopy} onChange={v => setCopy(prev => ({ ...prev, hookCopy: v }))} placeholder="후킹 문구" style={styles.heroSubtitle} />
                    </div>
                  </>
                )}
                {heroPhoto && renderPhoto(heroPhoto, (hasCopyText ? SPACE.xl : SPACE.lg) + SECTION_GAP)}

                {/* 특별한점 */}
                {hasCopyText && (
                  <>
                    <div style={{ ...styles.sectionHeading, marginBottom: SPACE.md }}>특별한점</div>
                    {Array.from({ length: highlightCount }, (_, idx) => (
                      <div
                        key={idx}
                        style={{
                          margin: `0 ${PADDING_X}px ${idx === highlightCount - 1 ? SPACE.xl + SECTION_GAP : SPACE.sm}px`,
                          background: CARD_COLOR,
                          borderRadius: 14,
                          padding: '22px 30px',
                        }}
                      >
                        <EditableText
                          value={copy.highlights[idx] || ''}
                          onChange={v => updateHighlight(idx, v)}
                          placeholder={`특별한점 ${String(idx + 1).padStart(2, '0')}`}
                          style={styles.highlight}
                        />
                      </div>
                    ))}
                  </>
                )}

                {/* Feature blocks (01~0N), each sharing an even slice of the leftover photos */}
                {Array.from({ length: featureBlockCount }, (_, idx) => {
                  const number = String(idx + 1).padStart(2, '0');
                  const groupPhotos = featurePhotoGroups[idx] || [];
                  const feature = copy.features.find(f => f.number === number);
                  const title = feature?.title || '';
                  const description = feature?.description || '';
                  if (groupPhotos.length === 0 && !title.trim() && !description.trim()) return null;
                  return (
                    <div key={idx}>
                      {hasCopyText && (
                        <>
                          <div style={{ ...styles.featureNumber, marginTop: SPACE.lg, marginBottom: SPACE.xs }}>{number}</div>
                          <div style={{ marginBottom: SPACE.sm }}>
                            <EditableText value={title} onChange={v => updateFeatureField(number, 'title', v)} placeholder="특징 소제목" style={styles.featureTitle} />
                          </div>
                          <div style={{ marginBottom: SPACE.md }}>
                            <EditableText value={description} onChange={v => updateFeatureField(number, 'description', v)} placeholder="특징 설명" style={styles.featureDesc} />
                          </div>
                        </>
                      )}
                      {groupPhotos.map((photo, pIdx) =>
                        renderPhoto(photo, pIdx === groupPhotos.length - 1 ? SPACE.xs + SECTION_GAP : SPACE.sm)
                      )}
                    </div>
                  );
                })}

                {/* 마무리 문구 — closingPhoto (last upload) sits right above it, fixed */}
                {closingPhoto && renderPhoto(closingPhoto, SPACE.lg)}
                <div style={{ marginTop: SPACE.lg, marginBottom: SPACE.xl + SECTION_GAP }}>
                  {hasCopyText && (
                    <EditableText value={copy.closing} onChange={v => setCopy(prev => ({ ...prev, closing: v }))} placeholder="마무리 문구" style={styles.closingTitle} />
                  )}
                </div>

                {/* Product Information — always last */}
                {productInfoRows.length > 0 && (
                  <div style={{ paddingBottom: SPACE.xl }}>
                    <div style={{ ...styles.sectionHeading, marginBottom: SPACE.md }}>Product Information</div>
                    <div style={{ height: 1, background: templateStyle.textColor, margin: `0 ${PADDING_X}px ${SPACE.md}px` }} />
                    {productInfoRows.map((row, idx) => {
                      const isLast = idx === productInfoRows.length - 1;
                      return (
                        <React.Fragment key={row.label}>
                          <div style={{ display: 'flex', padding: `0 ${PADDING_X}px`, ...styles.productInfo, marginBottom: SPACE.sm }}>
                            <span style={{ fontWeight: 700, width: PRODUCT_INFO_LABEL_COLUMN, flexShrink: 0 }}>{row.label}</span>
                            <span style={{ fontWeight: 400 }}>{row.value}</span>
                          </div>
                          <div style={{ height: 1, background: isLast ? templateStyle.textColor : RULE_COLOR, margin: `0 ${PADDING_X}px ${isLast ? SPACE.lg : SPACE.sm}px` }} />
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                {/* Persistent paint layer — lives inside previewRef (unlike the erase-brush mask
                    below) so html2canvas bakes it into the exported/saved image. Always mounted once
                    there are photos so drawings stay visible after leaving draw mode; pointer events
                    only engage while drawMode is on. */}
                <canvas
                  ref={drawCanvasRef}
                  className="absolute inset-0"
                  style={{ width: '100%', height: '100%', pointerEvents: drawMode ? 'auto' : 'none', cursor: drawMode ? 'none' : 'default' }}
                  onPointerDown={handleDrawPointerDown}
                  onPointerMove={handleDrawPointerMove}
                  onPointerUp={handleDrawPointerUp}
                  onPointerLeave={handleDrawPointerLeave}
                />
              </div>
              {brushMode && (
                <canvas
                  ref={brushCanvasRef}
                  className="absolute inset-0 cursor-none"
                  style={{ width: '100%', height: '100%' }}
                  onPointerDown={handleBrushPointerDown}
                  onPointerMove={handleBrushPointerMove}
                  onPointerUp={handleBrushPointerUp}
                  onPointerLeave={handleBrushPointerLeave}
                />
              )}
              {brushMode && brushCursorPos && (
                <div
                  className="absolute rounded-full border-2 border-pink-400 bg-pink-400/20 pointer-events-none"
                  style={{
                    left: brushCursorPos.x,
                    top: brushCursorPos.y,
                    width: brushSize,
                    height: brushSize,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              )}
              {drawMode && drawCursorPos && (
                <div
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    left: drawCursorPos.x,
                    top: drawCursorPos.y,
                    width: Math.max(drawSize, 6),
                    height: Math.max(drawSize, 6),
                    transform: 'translate(-50%, -50%)',
                    border: `2px solid ${drawColor}`,
                    backgroundColor: drawTool === 'brush' ? `${drawColor}33` : 'transparent',
                  }}
                />
              )}
              </div>
              </div>
            )}
            </div>
          </div>

          {/* Side panel: inputs only — everything else is edited directly in the preview */}
          <div className="lg:w-80 flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">사진 업로드 (순서: 히어로 → 특징01~{String(featureBlockCount).padStart(2, '0')} → 마무리)</p>
              <label className="text-xs px-2 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-500 cursor-pointer inline-flex items-center gap-1">
                <UploadIcon className="h-3.5 w-3.5" /> 파일 업로드
                <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFilesSelect} />
              </label>
              <div className="flex flex-wrap gap-2">
                <div
                  tabIndex={0}
                  onPaste={handlePastePhoto}
                  title="클릭한 뒤 Ctrl+V(⌘V)로 복사한 이미지를 붙여넣으세요"
                  className="w-16 h-16 flex items-center justify-center rounded-md border-2 border-dashed border-slate-600 text-slate-500 hover:border-blue-500 hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer transition-colors"
                >
                  <PlusIcon />
                </div>
                {photos.map((photo, idx) => {
                    const role = idx === 0 ? '히어로' : idx === photos.length - 1 && photos.length >= 2 ? '마무리' : '특징';
                    const assignedOptions = groupProducts.filter(p => !!p.thumbnailDataUrl && p.thumbnailDataUrl === photo.dataUrl);
                    const isThumbnail = assignedOptions.length > 0;
                    const hasMultipleOptions = groupProducts.length > 1;
                    const starTitle = !isThumbnail
                      ? '대표이미지로 저장'
                      : hasMultipleOptions
                        ? `대표이미지로 지정됨: ${assignedOptions.map((p, i) => `옵션${groupProducts.indexOf(p) + 1}${p.color ? ` · ${p.color}` : ''}`).join(', ')}`
                        : '대표이미지로 지정됨';
                    return (
                      <div
                        key={photo.id}
                        data-photo-id={photo.id}
                        onPointerDown={handlePhotoPointerDown(photo.id)}
                        onPointerMove={handlePhotoPointerMove}
                        onPointerUp={handlePhotoPointerUp}
                        onPointerCancel={handlePhotoPointerCancel}
                        title={`${idx + 1}번째 · ${role} (드래그해서 순서 변경)`}
                        className="group relative w-16 h-16 cursor-grab active:cursor-grabbing"
                        style={{
                          opacity: draggingPhotoId === photo.id ? 0.4 : 1,
                          touchAction: 'none',
                          outline: dragOverPhotoId === photo.id && draggingPhotoId && draggingPhotoId !== photo.id ? '2px solid #3b82f6' : 'none',
                          outlineOffset: 1,
                        }}
                      >
                        {/* Clips only the thumbnail image to its rounded box — the star dropdown below
                            lives outside this wrapper so it isn't clipped along with the photo. */}
                        <div className="absolute inset-0 rounded-md overflow-hidden border border-slate-600 bg-slate-800">
                          <img src={photo.dataUrl} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
                          <span className="absolute bottom-0.5 left-0.5 text-[9px] leading-none px-1 py-0.5 rounded bg-slate-900/80 text-slate-200">
                            {role}
                          </span>
                        </div>
                        <div className="absolute top-0.5 left-0.5" ref={thumbnailAssignPhotoId === photo.id ? thumbnailAssignMenuRef : undefined}>
                          <button
                            onClick={() => handleStarClick(photo)}
                            className={`w-4 h-4 flex items-center justify-center rounded-full bg-slate-900/80 transition-opacity [&_svg]:h-2.5 [&_svg]:w-2.5 ${
                              isThumbnail ? 'text-yellow-400 opacity-100' : 'text-white opacity-0 group-hover:opacity-100'
                            }`}
                            title={starTitle}
                          >
                            <StarIcon />
                          </button>
                          {hasMultipleOptions && thumbnailAssignPhotoId === photo.id && (
                            <div
                              draggable={false}
                              onDragStart={e => e.preventDefault()}
                              className="absolute left-0 top-full mt-1 w-40 bg-slate-800 border border-slate-600 rounded-lg shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] z-[80] py-1 cursor-default"
                            >
                              <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                대표이미지로 지정할 옵션
                              </div>
                              {groupProducts.map((p, optionIdx) => {
                                const isAssignedToThis = p.thumbnailDataUrl === photo.dataUrl;
                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => handleAssignThumbnailToOption(photo, p.id)}
                                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                                      isAssignedToThis ? 'text-yellow-400 font-semibold' : 'text-slate-300 hover:bg-blue-600 hover:text-white'
                                    }`}
                                  >
                                    {isAssignedToThis ? '★ ' : ''}옵션{optionIdx + 1}{p.color ? ` · ${p.color}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => removePhoto(photo.id)}
                          className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-slate-900/80 text-white opacity-0 group-hover:opacity-100 transition-opacity [&_svg]:h-2.5 [&_svg]:w-2.5"
                          title="사진 삭제"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    );
                  })}
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                썸네일이나 미리보기 안에서 사진을 드래그하면 순서를 바꿀 수 있어요. 첫 번째 사진은 히어로, 마지막 사진은 마무리 문구 위에 고정되고, 그 사이 사진들은 특징 01~03 자리에 최대한 고르게 나뉘어 들어가요. + 타일을 클릭한 뒤 Ctrl+V(⌘V)로 복사한 이미지를 바로 붙여넣을 수도 있어요. {groupProducts.length > 1
                  ? '별 아이콘을 누르면 그 사진을 어느 옵션의 대표이미지로 쓸지 고를 수 있어요(옵션마다 다른 사진을 지정할 수 있어요).'
                  : `별 아이콘을 누르면 그 사진이 대표이미지(${product?.thumbnailFile || '순번s.png'})로 저장돼요.`}
                {' '}상세페이지는 저장하면 이 상품의 옵션 {groupProducts.length}개 모두에 똑같이 적용돼요.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-700">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">문구생성하기 (AI 자동 생성)</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                소구점을 적어두면 더 정확한 문구가 나와요. 스타일 지침은 이름을 붙여 저장해두고 다음에도 골라서 바로 쓸 수 있어요.
              </p>
              <textarea
                value={sellingPoints}
                onChange={e => setSellingPoints(e.target.value)}
                placeholder="소구점 메모 (예: 방수, 초경량, 3중 스티칭 등 쉼표로 구분)"
                rows={2}
                className="w-full px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100 placeholder:text-slate-500 resize-none"
              />
              <div className="flex items-center gap-2">
                <select
                  value={selectedPromptId}
                  onChange={e => handleSelectPrompt(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100"
                >
                  <option value="">직접 입력 (저장 안 함)</option>
                  {savedPrompts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {selectedPromptId && (
                  <button
                    onClick={handleDeleteSelectedPrompt}
                    title="선택한 프롬프트 삭제"
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md bg-slate-700 text-slate-300 hover:bg-red-600 hover:text-white transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
              <textarea
                value={promptInstruction}
                onChange={e => setPromptInstruction(e.target.value)}
                placeholder="문구 스타일/톤 지침 (예: 20대 여성 타깃, 친근하고 발랄한 말투로 작성해줘)"
                rows={3}
                className="w-full px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100 placeholder:text-slate-500 resize-none"
              />
              <button
                onClick={handleSaveCurrentPrompt}
                disabled={!promptInstruction.trim()}
                className="w-full px-3 py-1.5 text-xs bg-slate-700 text-slate-100 font-semibold rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이름 지정해서 프롬프트 저장
              </button>
              {copyGenStatus === 'error' && (
                <p className="text-xs text-red-400">{copyGenError}</p>
              )}
              <button
                onClick={handleGenerateCopy}
                disabled={copyGenStatus === 'loading' || !product}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {copyGenStatus === 'loading'
                  ? <><SpinnerIcon className="h-4 w-4 animate-spin" /> 생성 중...</>
                  : <><SparklesIcon className="h-4 w-4" /> 문구생성하기</>}
              </button>
              <p className="text-xs text-slate-500 leading-relaxed">
                현재 설정된 특별한점 {highlightCount}개, 특징 {featureBlockCount}개에 맞춰 생성되고, 생성된 문구는 기존 내용을 덮어써요.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-700">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">문구 직접 붙여넣기</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                "제품명 / 후킹 문구 / &lt;사진&gt; / 특별한점 01~{String(highlightCount).padStart(2, '0')} / 01~{String(featureBlockCount).padStart(2, '0')} / 마무리 문구" 형식으로 직접 작성했거나 ChatGPT/Gemini 등에서 받은 문구를 아래에 붙여넣으면 그대로 배치돼요. 프롬프트를 복사해서 AI 채팅에 먼저 물어봐도 되고(무료, API 호출 없음), 직접 타이핑해도 돼요.
              </p>
              <button
                onClick={handleCopyPrompt}
                disabled={photos.length === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-700 text-slate-100 font-semibold rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {promptCopyStatus === 'copied' ? '복사됨!' : 'AI용 프롬프트 복사하기'}
              </button>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                placeholder="여기에 문구를 붙여넣거나 직접 입력하세요"
                rows={14}
                className="w-full px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100 placeholder:text-slate-500 resize-none"
              />
              <button
                onClick={handleApplyPasted}
                disabled={!pastedText.trim()}
                className="w-full px-3 py-2 text-sm bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                붙여넣은 문구 적용
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-700">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">템플릿 스타일</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14 flex-shrink-0">폰트</span>
                <select
                  value={templateStyle.fontFamily}
                  onChange={e => setTemplateStyle(prev => ({ ...prev, fontFamily: e.target.value }))}
                  className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100"
                >
                  {FONT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14 flex-shrink-0">글씨색</span>
                <input
                  type="color"
                  value={templateStyle.textColor}
                  onChange={e => setTemplateStyle(prev => ({ ...prev, textColor: e.target.value }))}
                  className="w-9 h-7 rounded-md border border-slate-600 bg-slate-800 cursor-pointer"
                />
                <span className="text-xs text-slate-500 tabular-nums">{templateStyle.textColor}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14 flex-shrink-0">글씨크기</span>
                <input
                  type="range"
                  min={0.7}
                  max={1.5}
                  step={0.05}
                  value={templateStyle.fontScale}
                  onChange={e => setTemplateStyle(prev => ({ ...prev, fontScale: Number(e.target.value) }))}
                  className="flex-1"
                />
                <span className="text-xs text-slate-400 w-10 text-right tabular-nums">{Math.round(templateStyle.fontScale * 100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14 flex-shrink-0">특별한점</span>
                <button
                  onClick={() => setHighlightCount(c => Math.max(HIGHLIGHT_COUNT_MIN, c - 1))}
                  disabled={highlightCount <= HIGHLIGHT_COUNT_MIN}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm text-slate-200 tabular-nums">{highlightCount}개</span>
                <button
                  onClick={() => setHighlightCount(c => Math.min(HIGHLIGHT_COUNT_MAX, c + 1))}
                  disabled={highlightCount >= HIGHLIGHT_COUNT_MAX}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14 flex-shrink-0">특징 블록</span>
                <button
                  onClick={() => setFeatureBlockCount(c => Math.max(FEATURE_BLOCK_COUNT_MIN, c - 1))}
                  disabled={featureBlockCount <= FEATURE_BLOCK_COUNT_MIN}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm text-slate-200 tabular-nums">{featureBlockCount}개</span>
                <button
                  onClick={() => setFeatureBlockCount(c => Math.min(FEATURE_BLOCK_COUNT_MAX, c + 1))}
                  disabled={featureBlockCount >= FEATURE_BLOCK_COUNT_MAX}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-600 transition-colors">
            닫기
          </button>
          <button
            onClick={handleDownload}
            disabled={photos.length === 0 || isExporting}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isExporting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <DownloadIcon />} 다운로드
          </button>
          <button
            onClick={handleSave}
            disabled={photos.length === 0 || isExporting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExporting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <SaveIcon />} 상세 이미지로 저장
          </button>
        </div>
      </div>
      <ImageCropModal
        isOpen={!!cropTarget}
        imageDataUrl={cropTarget?.dataUrl ?? null}
        onCancel={cancelCropQueue}
        onApply={handleApplyCrop}
        queueIndex={cropQueueIndex}
        queueTotal={cropQueue.length}
      />
    </div>
  );
};

export default DetailPageBuilderModal;
