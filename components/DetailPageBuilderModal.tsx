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
import { CloseIcon, SpinnerIcon, SaveIcon, DownloadIcon, SparklesIcon, UploadIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon, BrushIcon, PlusIcon, StarIcon, CropIcon, CheckIcon, EyedropperIcon, UndoIcon, LineIcon, SquareIcon, CircleIcon, ArrowIcon, TextToolIcon } from './Icons';
import { editImageWithGemini, BRUSH_ERASE_PROMPT } from '../utils/geminiImageEdit';
import { generateDetailPageCopyWithGemini } from '../utils/detailPageCopyGemini';
import { saveFilesInProductFolder, productFolderName, detailSliceFileNames } from '../utils/fileSave';
import { generateId } from '../utils/id';
import { saveDetailPageDraft, loadDetailPageDraft, deleteDetailPageDraft } from '../data/detailPageDrafts';
import { withTimeout, stripClonedScripts, stripEmptySections, fixTextBaselineShift } from '../utils/html2canvasHelpers';
import ImageCropModal from './ImageCropModal';
import EditableText from './EditableText';
import { KimchiPreview, KimchiSectionPanel, KIMCHI_TYPE_SCALE, KIMCHI_TYPE_STEPS, KimchiTypeScale } from './KimchiDetailSections';
import { KimchiPreviewModern } from './KimchiDetailSectionsModern';
import { KimchiPreviewBold } from './KimchiDetailSectionsBold';
import { KimchiPreviewSales } from './KimchiDetailSectionsSales';
import {
  KimchiSection,
  createDefaultKimchiSections,
  ensureKimchiSummarySection,
  moveKimchiSection,
  removeKimchiSection,
  duplicateKimchiSection,
  appendKimchiSection,
  kimchiSectionHasText,
  buildKimchiCopyPrompt,
  parseKimchiCopyText,
} from '../utils/kimchiDetailTemplate';
import {
  CANVAS_WIDTH,
  PADDING_X,
  RULE_COLOR,
  CARD_COLOR,
  PRODUCT_INFO_LABEL_COLUMN,
  SPACE,
  SECTION_GAP,
  KIMCHI_SKIN_SECTION_GAP,
} from '../utils/detailPageLayout';

declare var html2canvas: any;

interface DetailPageBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  // 같은 URL을 공유하는 옵션(색상 등) 전체. product 하나만 있으면(옵션이 없는 상품) 이 배열도
  // product 하나만 담는다. 상세페이지는 이 그룹 전체에 동일하게 저장되고, 대표이미지만
  // 옵션(=배열의 각 항목)별로 다르게 지정할 수 있다.
  groupProducts: Product[];
  // 'detailDataUrls'는 완성된 상세페이지 이미지 전체다 — 페이지가 길면 MAX_SLICE_HEIGHT마다
  // 잘려 여러 장으로 오고, 짧으면 한 장짜리 배열로 온다.
  onSave: {
    (field: 'thumbnailDataUrl' | 'detailFile', value: string): void;
    (field: 'detailDataUrls', value: string[]): void;
  };
  // 업로드한 사진 중 하나를 특정 옵션(productId)의 대표이미지(thumbnailFile, 자동 이름
  // "{순번}s.png")로 지정한다. 모달을 닫지 않는다 — 대표이미지 지정은 상세페이지를 계속
  // 조립하는 중에 곁들여 하는 부수 동작이라, 전체를 마무리짓는 onSave('detailDataUrl', ...)
  // (모달을 닫는다, App.tsx의 handleSave 참고)과는 다르다.
  onSaveThumbnail: (productId: string, dataUrl: string) => void;
  // 어떤 레이아웃으로 조립할지. 'basic'이 상품등록에서 쓰던 기존 템플릿이고(기본값이라 기존
  // 호출부는 바꿀 게 없다), 'kimchi'는 헤더에서 여는 독립 모드 전용 김치 템플릿이다.
  templateId?: 'basic' | 'kimchi';
}

interface PhotoItem {
  id: string;
  dataUrl: string;
}

// Free-draw layer: brush strokes are freehand point paths, the rest are drag-defined shapes
// (from → to, in the same drawCanvas coordinate space as points). All persist as vector data (not
// baked into a bitmap) so they can be redrawn whenever the canvas is resized — see redrawDrawObjects.
type DrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'label';
// 'label'은 각도를 줄 수 있는 글상자다. CSS transform으로 회전시키면 저장할 때 쓰는 html2canvas가
// 회전된 요소 안의 글자를 제대로 못 앉혀서 화면과 결과가 달라진다 — 그래서 우리가 직접 캔버스에
// 그린다(ctx.rotate). 캔버스는 그려진 그대로 이미지가 되므로 미리보기와 저장본이 항상 같다.
type DrawObject =
  | { type: 'brush'; points: { x: number; y: number }[]; color: string; size: number }
  | { type: 'line' | 'rect' | 'ellipse' | 'arrow'; from: { x: number; y: number }; to: { x: number; y: number }; color: string; size: number }
  | {
      type: 'label';
      at: { x: number; y: number };   // 글상자 한가운데
      text: string;
      color: string;
      background: string;             // 'transparent'면 배경 없이 글자만
      fontSize: number;
      fontFamily: string;
      angle: number;                  // 도(deg). 음수면 오른쪽 위로 올라간다
    };

// 글상자 배경 알약의 안쪽 여백과 모서리.
const LABEL_PADDING_X = 34;
const LABEL_PADDING_Y = 16;

type DrawLabel = Extract<DrawObject, { type: 'label' }>;

const labelFont = (obj: DrawLabel) => `700 ${obj.fontSize}px "${obj.fontFamily}"`;

// 글상자가 차지하는 크기. 그리기와 클릭 판정이 같은 값을 봐야 해서 한 곳에서만 계산한다.
const measureLabel = (ctx: CanvasRenderingContext2D, obj: DrawLabel) => {
  ctx.save();
  ctx.font = labelFont(obj);
  const lines = obj.text.split('\n');
  const textWidth = Math.max(...lines.map(l => ctx.measureText(l || ' ').width));
  ctx.restore();
  const lineHeight = obj.fontSize * 1.25;
  return {
    width: textWidth + LABEL_PADDING_X * 2,
    height: lineHeight * lines.length + LABEL_PADDING_Y * 2,
  };
};

// 회전된 글상자 안을 클릭했는지. 점을 글상자 기준으로 되돌려 회전을 상쇄한 뒤 사각형 안인지 본다.
const isPointInLabel = (ctx: CanvasRenderingContext2D, obj: DrawLabel, p: { x: number; y: number }) => {
  const { width, height } = measureLabel(ctx, obj);
  const rad = (-obj.angle * Math.PI) / 180;
  const dx = p.x - obj.at.x;
  const dy = p.y - obj.at.y;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
};

// Free-placed text box: click anywhere on the live preview to drop one, drag to reposition, click to
// re-edit. Position is stored as a percentage of previewRef so it survives zoom and layout reflow,
// and the div lives inside previewRef so html2canvas bakes it into the exported image. fontSize is in
// the same 860px-wide coordinate space as every other text block (styles useMemo below).
interface DetailTextBox {
  id: string;
  text: string;
  xPct: number;
  yPct: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

// Default size (860px-space) for a newly dropped text box — between 특징 설명(46) and 소제목(62).
const DEFAULT_TEXT_BOX_FONT_SIZE = 50;
const TEXT_BOX_FONT_SIZE_MIN = 16;
const TEXT_BOX_FONT_SIZE_MAX = 160;

// Design width the whole preview is authored at (matches the reference detail page's proportions,
// see scratchpad measurement notes) — html2canvas captures this DOM 1:1 (scaled up) for export.
// 저장 파일 용량 제한(거래처 업로드 기준) — 초과 시 captureImage가 2x 오버샘플링 해상도를
// 실제 표시 배율(1x, CANVAS_WIDTH) 선까지만 단계적으로 낮춰서 화질 저하 없이 용량을 줄인다.
const MAX_DETAIL_IMAGE_BYTES = 10 * 1024 * 1024;
// 저장 이미지 한 장의 세로 한계. 마켓에 올릴 때 너무 긴 이미지를 받지 않는 곳이 있어서,
// 페이지가 이보다 길면 위에서부터 이 높이로 잘라 여러 장으로 나눠 저장한다.
const MAX_SLICE_HEIGHT = 3000;
// 올린 사진을 들고 있을 최대 가로 픽셀. 미리보기 폭이 CANVAS_WIDTH(860)이고 저장할 때 2배로
// 찍으므로 그 위쪽은 어차피 버려지는 화소다. 원본 그대로 두면 폰 사진 한 장이 4MB라 몇 장만
// 올려도 앱이 무거워지는데, 여기까지 줄이면 700KB 정도가 되고 눈에 보이는 차이는 없다.
const MAX_PHOTO_WIDTH = CANVAS_WIDTH * 2;
// 이 사진은 저장할 때 캡처 이미지 안으로 한 번 더 구워지므로(=JPEG 두 번) 여기서 너무 깎으면
// 최종 상세페이지에 그 손실이 그대로 남는다. 용량은 조금 늘지만 0.9로 잡는다.
const PHOTO_JPEG_QUALITY = 0.9;

// ── 캔버스 크기 한계 ──────────────────────────────────────────────────────────
// 브라우저가 만들 수 있는 캔버스에는 한 변 길이와 총 픽셀 수 두 가지 한계가 있다. 넘겨도
// 예외가 나지 않고 픽셀 할당만 조용히 실패하기 때문에, 넘긴 걸 알아챌 방법이 "저장된 이미지가
// 전부 하얗다"밖에 없다. 실제 한계(크롬 65535 / 사파리는 훨씬 낮다)보다 넉넉히 낮춰 잡는다.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_PIXELS = 128 * 1024 * 1024;
// 저장 이미지를 찍을 때 쓰는 오버샘플링 배율(글자가 또렷하게 나오도록 2배로 찍는다).
const CAPTURE_SCALE = 2;

// 가로가 한계를 넘지 않는 선에서 쓸 수 있는 가장 큰 배율. CANVAS_WIDTH(860)에서는 늘 2가 나오고,
// 혹시 폭을 크게 바꾸더라도 저절로 낮아진다.
const captureScaleFor = (fullWidth: number): number =>
  Math.min(CAPTURE_SCALE, Math.max(1, MAX_CANVAS_SIDE / Math.max(1, fullWidth)));

// 한 번에 찍어도 안전한 세로 길이(CSS px). 세로 한계와 총 픽셀 한계 중 빡빡한 쪽을 따르고,
// 김치 템플릿이 어차피 MAX_SLICE_HEIGHT로 자르므로 그 배수로 떨어뜨려 띠 경계와 자르는 경계가
// 어긋나지 않게 한다.
const captureBandHeight = (fullWidth: number, scale: number): number => {
  const bySide = MAX_CANVAS_SIDE / scale;
  const byPixels = MAX_CANVAS_PIXELS / Math.max(1, fullWidth * scale * scale);
  const limit = Math.floor(Math.min(bySide, byPixels));
  const sliceCss = MAX_SLICE_HEIGHT / scale;
  return Math.max(sliceCss, Math.floor(limit / sliceCss) * sliceCss);
};

// 헤더 "상페작업"으로 여는 상세페이지는 상품 목록에 행이 없어서, 작업 내용을 되돌려 넣을 곳도
// 없다. 그래서 만들다 만 상태를 이 컴퓨터(IndexedDB)에 통째로 넣어두고 다시 열 때 되살린다.
// 상품등록에서 여는 쪽은 완성본이 상품 행에 붙으므로 여기 대상이 아니다.
export const STANDALONE_DRAFT_ID = 'standalone-kimchi';
// 마지막 입력에서 이만큼 쉬면 한 번 저장한다. 글자마다 쓰면 사진까지 통째로 다시 굽게 된다.
const DRAFT_SAVE_DELAY_MS = 1200;
// Numbered feature blocks (01~0N) that share the uploaded photos left over after the fixed
// hero/closing slots — see distributePhotos below. Count is user-adjustable (see featureBlockCount).

// Fonts already loaded in index.html (Pretendard/Paperlogy/NanumSquareRound via jsdelivr, the rest via Google Fonts).
const FONT_OPTIONS = [
  { label: 'Paperlogy', value: 'Paperlogy' },
  { label: '나눔스퀘어라운드', value: 'Nanum Square Round' },
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

type KimchiSkin = 'basic' | 'modern' | 'bold' | 'sales';

// 이 컴퓨터에 저장해두는 "만들다 만 상세페이지". 사진은 이미 화면에서 쓰는 해상도까지 줄여
// 들고 있으므로(MAX_PHOTO_WIDTH) 그대로 담는다 — 사진을 빼면 섹션 배정·순서·자른 모양이
// 전부 날아가서 이어서 작업한다는 말이 무의미해진다.
interface KimchiDraft {
  photos: PhotoItem[];
  photoSectionMap: Record<string, string>;
  kimchiSections: KimchiSection[];
  kimchiPastedText: string;
  textBoxes: DetailTextBox[];
  drawObjects: DrawObject[];
  sellingPoints: string;
  kimchiSkin: KimchiSkin;
  kimchiAccents: Record<KimchiSkin, string>;
  kimchiTypeScale: KimchiTypeScale;
  templateStyle: TemplateStyleSettings;
}

const DetailPageBuilderModal: React.FC<DetailPageBuilderModalProps> = ({ isOpen, onClose, product, groupProducts, onSave, onSaveThumbnail, templateId = 'basic' }) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const isKimchi = templateId === 'kimchi';
  // 김치 템플릿 전용 상태. 사진 배열(photos)은 두 템플릿이 그대로 공유해서 자르기·드래그 정렬·
  // 스포이드 등 기존 기능이 전부 살아 있고, 여기에 "이 사진이 어느 섹션 것인지"만 따로 기억한다
  // (photoSectionMap: photoId → 섹션 id). 그래서 업로드 순서가 자리에 영향을 주지 않는다.
  const [kimchiSections, setKimchiSections] = useState<KimchiSection[]>(createDefaultKimchiSections);
  // 어떤 스킨으로 그릴지. 섹션 구조와 문구는 그대로 두고 그리는 방식만 바뀌므로, 같은 문구를
  // 붙여넣은 채로 왔다 갔다 하며 두 디자인을 비교할 수 있다.
  const [kimchiSkin, setKimchiSkin] = useState<KimchiSkin>('basic');
  // 템플릿마다 시그니처 색을 따로 기억한다. 섹션이 자기 강조색을 지정하지 않았으면 이 색을 쓴다.
  const [kimchiAccents, setKimchiAccents] = useState<Record<KimchiSkin, string>>({
    basic: '#d4462a',
    modern: '#2f5d50',
    bold: '#c2410c',
    sales: '#2f9e44',
  });
  const kimchiAccent = kimchiAccents[kimchiSkin];
  // 김치 템플릿의 글자 크기는 다섯 단계뿐이고(KIMCHI_TYPE_SCALE), 그 다섯 개의 실제 px을 여기서
  // 정한다. 역할별로 따로 만지는 게 아니라 단계를 만지는 것이라, 한 번 조절하면 그 단계를 쓰는
  // 모든 문구가 같이 움직인다 — 페이지 안에서 크기 위계가 어긋나지 않는다.
  const [kimchiTypeScale, setKimchiTypeScale] = useState<KimchiTypeScale>(KIMCHI_TYPE_SCALE);
  const [photoSectionMap, setPhotoSectionMap] = useState<Record<string, string>>({});
  const [kimchiPastedText, setKimchiPastedText] = useState('');
  // 미리보기에서 우클릭한 자리. 그 섹션의 어느 사진 앞에 넣을지까지 함께 들고 있다가,
  // 파일을 고르거나 붙여넣으면 정확히 그 자리에 사진을 끼워 넣는다.
  const [photoInsertTarget, setPhotoInsertTarget] = useState<
    { sectionId?: string; beforePhotoId?: string; left: number; top: number } | null
  >(null);
  // 미리보기에서 글자를 드래그로 고르면 뜨는 서식 툴바(색/크기/굵게). 고른 범위에만 적용된다.
  // savedRangeRef: 색상 선택기처럼 포커스를 가져가는 UI를 거치면 선택이 풀리므로, 툴바가 뜬
  // 시점의 범위를 들고 있다가 적용 직전에 되살린다.
  const [formatBar, setFormatBar] = useState<{ left: number; top: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
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
  // 시작 폰트는 템플릿마다 다르다 — 김치 템플릿은 프리텐다드, 기존 상품등록 템플릿은 지금까지
  // 쓰던 Paperlogy 그대로. 둘 다 화면에서 언제든 바꿀 수 있다.
  const [templateStyle, setTemplateStyle] = useState<TemplateStyleSettings>(() => ({
    ...DEFAULT_TEMPLATE_STYLE,
    fontFamily: templateId === 'kimchi' ? 'Pretendard' : DEFAULT_TEMPLATE_STYLE.fontFamily,
  }));
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
  // 지금 고른 글상자의 위치(drawObjects 안 인덱스). 고르면 옆 패널에서 글자·각도·색을 바꿀 수 있다.
  const [selectedLabelIndex, setSelectedLabelIndex] = useState<number | null>(null);
  const labelDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const eyedropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;

  // Free text boxes dropped straight onto the preview (see DetailTextBox). Only interactive while
  // textMode is on; otherwise they render purely as baked-in content (pointer events off).
  const [textMode, setTextMode] = useState(false);
  const [textBoxes, setTextBoxes] = useState<DetailTextBox[]>([]);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const textBoxElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const draggingTextBoxIdRef = useRef<string | null>(null);
  const textBoxDragMovedRef = useRef(false);

  // Photos being cropped — a single click on one photo opens just that one; the toolbar's
  // "선택한 사진 크롭" button opens every checked photo instead. The modal shows them all at once;
  // one "자르기 적용" click crops the whole batch and writes every result back to `photos` together
  // (see handleApplyCrop). Cancelling discards the whole batch.
  const [cropTargets, setCropTargets] = useState<PhotoItem[]>([]);

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
  // 김치 템플릿은 사진 없이 문구만으로도 페이지가 성립하므로(표시사항 표만 있는 경우 등), 사진
  // 유무만 보던 기존 조건 대신 "사진이든 문구든 하나라도 있으면" 미리보기/내보내기를 허용한다.
  const kimchiHasContent = useMemo(() => kimchiSections.some(kimchiSectionHasText), [kimchiSections]);
  const selectedLabel =
    selectedLabelIndex !== null && drawObjects[selectedLabelIndex]?.type === 'label'
      ? (drawObjects[selectedLabelIndex] as DrawLabel)
      : null;
  const hasRenderableContent = photos.length > 0 || (isKimchi && kimchiSections.length > 0);
  // 섹션 id → 그 섹션에 배정된 사진들(photos의 순서를 그대로 따르므로 드래그 정렬도 반영된다).
  const photosBySection = useMemo(() => {
    const grouped: Record<string, PhotoItem[]> = {};
    photos.forEach(photo => {
      const sectionId = photoSectionMap[photo.id];
      if (!sectionId) return;
      (grouped[sectionId] ||= []).push(photo);
    });
    return grouped;
  }, [photos, photoSectionMap]);
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
  const draftsRef = useRef<Map<string, { photos: PhotoItem[]; sellingPoints: string; copy: DetailPageCopy; pastedText: string; drawObjects: DrawObject[]; textBoxes: DetailTextBox[]; kimchiSections: KimchiSection[]; photoSectionMap: Record<string, string>; kimchiPastedText: string }>>(new Map());
  const activeProductIdRef = useRef<string | null>(null);

  // 만들다 만 상세페이지를 이 컴퓨터(IndexedDB)에 통째로 넣어두고, 다시 열면 되살린다.
  // 마지막으로 저장한 시각은 화면 아래에 보여줘서 "앱을 닫아도 남아 있다"는 걸 알 수 있게 한다.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // 되살리기를 시도하기 전까지는 자동 저장을 하지 않는다. 먼저 저장해버리면 아직 못 읽은
  // 예전 작업을 빈 화면으로 덮어쓰게 된다.
  const [draftReady, setDraftReady] = useState(false);
  const draftRestoreStartedRef = useRef(false);
  // 되살리기 직전에 "지금 화면에 이미 만들어둔 게 있는지" 보려고 최신 값을 들고 있는다.
  const liveRef = useRef({ photos, textBoxes, drawObjects });
  liveRef.current = { photos, textBoxes, drawObjects };

  const collectKimchiDraft = (): KimchiDraft => ({
    photos, photoSectionMap, kimchiSections, kimchiPastedText, textBoxes, drawObjects, sellingPoints,
    kimchiSkin, kimchiAccents, kimchiTypeScale, templateStyle,
  });

  // 상페작업 창을 처음 열 때 한 번 읽어 온다.
  useEffect(() => {
    if (!isOpen || !isKimchi || draftRestoreStartedRef.current) return;
    draftRestoreStartedRef.current = true;
    let cancelled = false;
    void (async () => {
      const saved = await loadDetailPageDraft<KimchiDraft>(STANDALONE_DRAFT_ID);
      if (cancelled) return;
      const live = liveRef.current;
      // 읽는 사이에 사용자가 벌써 뭔가 올렸다면 그쪽이 최신이다 — 덮지 않는다.
      const untouched = live.photos.length === 0 && live.textBoxes.length === 0 && live.drawObjects.length === 0;
      if (saved && untouched) {
        const d = saved.data;
        setPhotos(d.photos ?? []);
        setPhotoSectionMap(d.photoSectionMap ?? {});
        setKimchiSections(d.kimchiSections ? ensureKimchiSummarySection(d.kimchiSections) : createDefaultKimchiSections());
        setKimchiPastedText(d.kimchiPastedText ?? '');
        setTextBoxes(d.textBoxes ?? []);
        setDrawObjects(d.drawObjects ?? []);
        setSellingPoints(d.sellingPoints ?? '');
        if (d.kimchiSkin) setKimchiSkin(d.kimchiSkin);
        if (d.kimchiAccents) setKimchiAccents(d.kimchiAccents);
        if (d.kimchiTypeScale) setKimchiTypeScale(d.kimchiTypeScale);
        if (d.templateStyle) setTemplateStyle(d.templateStyle);
        setDraftSavedAt(saved.savedAt);
      }
      setDraftReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isKimchi]);

  // 바뀔 때마다 자동 저장. 창이 닫혀 있어도 저장한다 — 닫기만 누르고 앱을 끄는 게 보통이라.
  useEffect(() => {
    if (!isKimchi || !draftReady) return;
    const timer = setTimeout(() => {
      void saveDetailPageDraft(STANDALONE_DRAFT_ID, collectKimchiDraft()).then(() => setDraftSavedAt(Date.now()));
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKimchi, draftReady, photos, photoSectionMap, kimchiSections, kimchiPastedText, textBoxes,
      drawObjects, sellingPoints, kimchiSkin, kimchiAccents, kimchiTypeScale, templateStyle]);

  // 창을 닫는 순간에도 한 번 저장한다. 자동 저장은 잠깐 쉴 때 걸리므로, 마지막 몇 글자를
  // 치자마자 닫으면 그 타이머가 취소돼 빠질 수 있다.
  const kimchiWasOpenRef = useRef(false);
  useEffect(() => {
    const openNow = isOpen && isKimchi;
    if (kimchiWasOpenRef.current && !openNow && draftReady) {
      void saveDetailPageDraft(STANDALONE_DRAFT_ID, collectKimchiDraft()).then(() => setDraftSavedAt(Date.now()));
    }
    kimchiWasOpenRef.current = openNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isKimchi]);

  // 저장해둔 작업을 버리고 빈 화면에서 다시 시작한다. 자동 저장이라 지우는 길이 따로 있어야 한다.
  const handleResetKimchiDraft = async () => {
    if (!window.confirm('지금 작업 중인 상세페이지를 지우고 새로 시작할까요?\n이 컴퓨터에 저장해둔 내용도 함께 지워집니다.')) return;
    await deleteDetailPageDraft(STANDALONE_DRAFT_ID);
    draftsRef.current.delete(STANDALONE_DRAFT_ID);
    setPhotos([]);
    setPhotoSectionMap({});
    setKimchiSections(createDefaultKimchiSections());
    setKimchiPastedText('');
    setTextBoxes([]);
    setDrawObjects([]);
    setSellingPoints('');
    setDraftSavedAt(null);
  };

  useEffect(() => {
    const nextId = product?.id ?? null;
    const prevId = activeProductIdRef.current;
    if (prevId && prevId !== nextId) {
      draftsRef.current.set(prevId, { photos, sellingPoints, copy, pastedText, drawObjects, textBoxes, kimchiSections, photoSectionMap, kimchiPastedText });
    }
    if (nextId && nextId !== prevId) {
      const draft = draftsRef.current.get(nextId);
      setPhotos(draft?.photos ?? []);
      setSellingPoints(draft?.sellingPoints ?? product?.detailSellingPoints ?? '');
      // 1688 확장에서 문구까지 받아온 상품이면, 처음 열 때 그 문구를 바로 반영해준다
      // (사용자가 "붙여넣기 → 적용"을 다시 하지 않아도 되게).
      // 제품명은 AI가 지어낸 이름이 아니라 확장에서 직접 입력한 상품명을 쓴다.
      const importedCopy = !draft && product?.detailCopyText
        ? (() => {
            const parsed = parseDetailPageCopyText(product.detailCopyText, highlightCount, featureBlockCount);
            return { ...parsed, productName: product.productName || parsed.productName };
          })()
        : null;
      setCopy(draft?.copy ?? importedCopy ?? EMPTY_COPY);
      setPastedText(draft?.pastedText ?? product?.detailCopyText ?? '');
      setDrawObjects(draft?.drawObjects ?? []);
      setTextBoxes(draft?.textBoxes ?? []);
      setKimchiSections(draft?.kimchiSections ? ensureKimchiSummarySection(draft.kimchiSections) : createDefaultKimchiSections());
      setPhotoSectionMap(draft?.photoSectionMap ?? {});
      setKimchiPastedText(draft?.kimchiPastedText ?? '');
    }
    activeProductIdRef.current = nextId;
    setBrushMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setEraseStatus('idle');
    setEraseError('');
    setDrawMode(false);
    setTextMode(false);
    setSelectedTextBoxId(null);
    setEditingTextBoxId(null);
    setSelectedLabelIndex(null);
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
    setTextMode(false);
    setSelectedTextBoxId(null);
    setEditingTextBoxId(null);
    setSelectedLabelIndex(null);
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
    // 글상자는 선 굵기(size)를 쓰지 않고 자기 방식으로 그리므로 공통 설정 전에 빠진다.
    if (obj.type === 'label') {
      const { width, height } = measureLabel(ctx, obj);
      ctx.save();
      ctx.translate(obj.at.x, obj.at.y);
      ctx.rotate((obj.angle * Math.PI) / 180);
      if (obj.background !== 'transparent') {
        ctx.fillStyle = obj.background;
        const r = Math.min(height / 2, 20);
        const x = -width / 2;
        const y = -height / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = obj.color;
      ctx.font = labelFont(obj);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      obj.text.split('\n').forEach((line, i, lines) => {
        const lineHeight = obj.fontSize * 1.25;
        ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineHeight);
      });
      ctx.restore();
      return;
    }
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
    if (!canvas || !preview || !hasRenderableContent) return;
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
  }, [photos.length, hasRenderableContent]);

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

  // Drag-to-reposition a free text box: window-level listeners so the pointer can leave the small box
  // mid-drag. Positions are a percent of previewRef (see previewPctFromEvent).
  useEffect(() => {
    if (!textMode) return;
    const handleMove = (e: PointerEvent) => {
      const id = draggingTextBoxIdRef.current;
      if (!id || !previewRef.current) return;
      textBoxDragMovedRef.current = true;
      const rect = previewRef.current.getBoundingClientRect();
      const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      setTextBoxes(prev => prev.map(b => (b.id === id ? { ...b, xPct, yPct } : b)));
    };
    const handleUp = () => {
      draggingTextBoxIdRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [textMode]);

  // Focus a text box the moment it enters edit mode and drop the caret at the end.
  useEffect(() => {
    if (!editingTextBoxId) return;
    const el = textBoxElRefs.current.get(editingTextBoxId);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingTextBoxId]);

  // 미리보기 안에서 글자를 고를 때만 서식 툴바를 띄운다.
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setFormatBar(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
      const editable = el?.closest('[contenteditable="true"]') as HTMLElement | null;
      if (!editable || !previewRef.current?.contains(editable)) {
        setFormatBar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setFormatBar(null);
        return;
      }
      savedRangeRef.current = range.cloneRange();
      setFormatBar({ left: rect.left + rect.width / 2, top: rect.top });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // 상세페이지의 제품명은 AI가 지어낸 이름이 아니라 상품에 입력된 상품명을 따른다.
  // 확장에서 값을 채우는 데 시간이 걸려 에디터가 먼저 열리는 경우가 있어, 상품명이 뒤늦게
  // 들어와도 반영되게 상품명이 바뀔 때마다 맞춰 준다.
  useEffect(() => {
    const name = product?.productName;
    if (!name) return;
    setCopy(prev => (prev.productName === name ? prev : { ...prev, productName: name }));
  }, [product?.productName]);

  if (!isOpen) return null;

  // sectionId를 주면 그 사진을 해당 섹션에 배정한다(김치 템플릿의 섹션별 업로드). 기본 템플릿은
  // sectionId 없이 부르고, 사진은 예전처럼 업로드 순서대로만 배치된다.
  // sectionId를 주면 그 섹션에 배정하고, beforePhotoId를 주면 그 사진 바로 앞에 끼워 넣는다
  // (미리보기에서 우클릭한 자리에 넣을 때 쓴다). 둘 다 없으면 예전처럼 맨 뒤에 붙는다.
  const addPhotoFiles = (files: File[], sectionId?: string, beforePhotoId?: string) => {
    // 원본을 그대로 들고 있지 않고 화면에서 쓰는 해상도까지 줄여 넣는다(shrinkPhotoDataUrl).
    // 여러 장을 한 번에 골라도 고른 순서가 뒤섞이지 않도록 한 장씩 차례로 처리한다.
    void (async () => {
      for (const file of files) {
        const raw = await readFileAsDataUrl(file);
        if (!raw) continue;
        const dataUrl = await shrinkPhotoDataUrl(raw);
        const id = generateId();
        const photo = { id, dataUrl };
        setPhotos(prev => {
          if (!beforePhotoId) return [...prev, photo];
          const idx = prev.findIndex(p => p.id === beforePhotoId);
          return idx === -1 ? [...prev, photo] : [...prev.slice(0, idx), photo, ...prev.slice(idx)];
        });
        if (sectionId) setPhotoSectionMap(prev => ({ ...prev, [id]: sectionId }));
      }
    })();
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
    setPhotoSectionMap(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
    setCropTargets(targets);
  };

  const cancelCropQueue = () => {
    setCropTargets([]);
  };

  const handleApplyCrop = (results: Record<string, string>) => {
    // Commit every crop in the batch to `photos` in one update; photos left untouched in the modal
    // simply won't appear in `results`.
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
    setTextMode(false);
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
    setTextMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setDrawMode(prev => !prev);
  };

  // --- Free text boxes on the preview ---
  const toggleTextMode = () => {
    setBrushMode(false);
    setDrawMode(false);
    setHasPainted(false);
    paintedBoundsRef.current = null;
    setTextMode(prev => {
      if (prev) {
        // Leaving text mode: commit whatever's being typed and drop the selection chrome.
        textBoxElRefs.current.get(editingTextBoxId ?? '')?.blur();
        setSelectedTextBoxId(null);
        setEditingTextBoxId(null);
      }
      return !prev;
    });
  };

  const addTextBox = (xPct: number, yPct: number) => {
    const id = generateId();
    setTextBoxes(prev => [
      ...prev,
      {
        id,
        text: '',
        xPct,
        yPct,
        fontSize: DEFAULT_TEXT_BOX_FONT_SIZE,
        fontFamily: templateStyle.fontFamily,
        color: templateStyle.textColor,
        bold: true,
        italic: false,
        align: 'center',
      },
    ]);
    setSelectedTextBoxId(id);
    setEditingTextBoxId(id);
  };

  const updateTextBox = (id: string, patch: Partial<DetailTextBox>) => {
    setTextBoxes(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeTextBox = (id: string) => {
    setTextBoxes(prev => prev.filter(b => b.id !== id));
    setSelectedTextBoxId(prev => (prev === id ? null : prev));
    setEditingTextBoxId(prev => (prev === id ? null : prev));
  };

  // Percent-of-previewRef coordinates for a click, unaffected by the zoom transform since the
  // bounding rect already reflects the scaled size.
  const previewPctFromEvent = (clientX: number, clientY: number) => {
    const rect = previewRef.current!.getBoundingClientRect();
    return {
      xPct: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      yPct: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const handleTextStageClick = (e: React.MouseEvent) => {
    if (!previewRef.current) return;
    // A click on empty canvas: first tap just clears the current selection/edit, next drops a box.
    if (editingTextBoxId) {
      setEditingTextBoxId(null);
      return;
    }
    if (selectedTextBoxId) {
      setSelectedTextBoxId(null);
      return;
    }
    const { xPct, yPct } = previewPctFromEvent(e.clientX, e.clientY);
    addTextBox(xPct, yPct);
  };

  const handleTextBoxPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (editingTextBoxId === id) return;
    setSelectedTextBoxId(id);
    draggingTextBoxIdRef.current = id;
    textBoxDragMovedRef.current = false;
  };

  const handleTextBoxClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (textBoxDragMovedRef.current) {
      textBoxDragMovedRef.current = false;
      return;
    }
    if (editingTextBoxId === id) return;
    if (selectedTextBoxId === id) setEditingTextBoxId(id);
    else setSelectedTextBoxId(id);
  };

  const handleTextBoxBlur = (e: React.FocusEvent<HTMLDivElement>, id: string) => {
    const finalText = (e.currentTarget.innerText || '').replace(/\n+$/, '');
    setEditingTextBoxId(prev => (prev === id ? null : prev));
    setTextBoxes(prev => {
      if (finalText.trim() === '') return prev.filter(b => b.id !== id);
      return prev.map(b => (b.id === id ? { ...b, text: finalText } : b));
    });
  };

  const selectedTextBox = textBoxes.find(b => b.id === selectedTextBoxId) || null;

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
  // 글상자 도구: 이미 있는 글상자를 누르면 고르고(그대로 끌어서 옮길 수 있다), 빈 곳을 누르면
  // 거기에 새 글상자를 만든다.
  const handleLabelPointerDown = (canvas: HTMLCanvasElement, point: { x: number; y: number }) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const hitIndex = [...drawObjects]
      .map((obj, index) => ({ obj, index }))
      .reverse()
      .find(({ obj }) => obj.type === 'label' && isPointInLabel(ctx, obj, point))?.index;
    if (hitIndex !== undefined) {
      const hit = drawObjects[hitIndex] as DrawLabel;
      setSelectedLabelIndex(hitIndex);
      labelDragOffsetRef.current = { x: point.x - hit.at.x, y: point.y - hit.at.y };
      return;
    }
    const created: DrawLabel = {
      type: 'label',
      at: point,
      text: '문구를 입력하세요',
      color: '#ffffff',
      background: drawColor,
      fontSize: 44,
      fontFamily: templateStyle.fontFamily,
      angle: 0,
    };
    setDrawObjects(prev => {
      setSelectedLabelIndex(prev.length);
      return [...prev, created];
    });
    labelDragOffsetRef.current = { x: 0, y: 0 };
  };

  const updateSelectedLabel = (patch: Partial<DrawLabel>) => {
    if (selectedLabelIndex === null) return;
    setDrawObjects(prev =>
      prev.map((obj, i) => (i === selectedLabelIndex && obj.type === 'label' ? { ...obj, ...patch } : obj))
    );
  };

  const deleteSelectedLabel = () => {
    if (selectedLabelIndex === null) return;
    setDrawObjects(prev => prev.filter((_, i) => i !== selectedLabelIndex));
    setSelectedLabelIndex(null);
  };

  const handleDrawPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const point = getPointOnCanvas(canvas, e);
    setDrawCursorPos(point);
    if (drawTool === 'label') {
      handleLabelPointerDown(canvas, point);
      return;
    }
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
    if (drawTool === 'label') {
      const point = getPointOnCanvas(e.currentTarget, e);
      setDrawCursorPos(point);
      const offset = labelDragOffsetRef.current;
      if (offset && selectedLabelIndex !== null && e.buttons === 1) {
        updateSelectedLabel({ at: { x: point.x - offset.x, y: point.y - offset.y } });
      }
      return;
    }
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
    if (drawTool === 'label') {
      labelDragOffsetRef.current = null;
      return;
    }
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
  // live preview (photos + all text) into canvases via html2canvas.
  //
  // 한 장으로 다 담지 않고 "띠"로 나눠 찍는 이유: 상세페이지가 길어지면 (사진 스무 장이 넘으면
  // 금방) 2배로 찍은 캔버스의 세로가 브라우저 한계를 넘는다. 한계를 넘으면 예외가 나는 게 아니라
  // 픽셀 할당만 조용히 실패해서 **전부 흰 이미지**가 저장된다. 그래서 처음부터 안전한 높이로
  // 잘라 여러 번 찍는다. 짧은 페이지는 예전처럼 딱 한 번만 찍는다.
  const captureBands = async (): Promise<HTMLCanvasElement[] | null> => {
    if (!previewRef.current || !hasRenderableContent) return null;
    const previousZoom = zoom;
    try {
      if (previousZoom !== 1) {
        setZoom(1);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      await Promise.all([
        document.fonts.load(`700 89px "${templateStyle.fontFamily}"`).catch(() => undefined),
        document.fonts.load(`400 46px "${templateStyle.fontFamily}"`).catch(() => undefined),
        // Fonts picked per free text box may differ from the template font.
        ...Array.from(new Set(textBoxes.map(b => b.fontFamily))).flatMap(f => [
          document.fonts.load(`700 50px "${f}"`).catch(() => undefined),
          document.fonts.load(`400 50px "${f}"`).catch(() => undefined),
        ]),
      ]);
      // previewRef sits inside a scrollable panel; without explicit width/height html2canvas
      // only captures the currently-scrolled-into-view slice instead of the full page.
      const fullWidth = previewRef.current.scrollWidth;
      const fullHeight = previewRef.current.scrollHeight;
      const scale = captureScaleFor(fullWidth);
      const bandHeight = captureBandHeight(fullWidth, scale);

      // html2canvas의 x/y는 "찍을 요소의 왼쪽 위"에서 잰 값이라, y만 옮기면 그 아래 띠가 나온다.
      // width/height를 준 만큼만 캔버스로 나오므로 띠 하나가 곧 캔버스 하나다.
      const bands: HTMLCanvasElement[] = [];
      for (let top = 0; top < fullHeight; top += bandHeight) {
        const height = Math.min(bandHeight, fullHeight - top);
        const canvas: HTMLCanvasElement = await withTimeout(
          html2canvas(previewRef.current, {
            backgroundColor: '#ffffff',
            scale,
            useCORS: true,
            x: 0,
            y: top,
            width: fullWidth,
            height,
            windowWidth: fullWidth,
            windowHeight: fullHeight,
            ignoreElements: (el: Element) => el.hasAttribute('data-html2canvas-ignore'),
            onclone: (clonedDoc: Document) => {
              stripClonedScripts(clonedDoc);
              stripEmptySections(clonedDoc);
              fixTextBaselineShift(clonedDoc);
            },
          }),
          20000,
          '상세페이지 캡처'
        );
        bands.push(canvas);
      }
      return bands;
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

  const readFileAsDataUrl = (file: File): Promise<string | null> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

  // 사진을 MAX_PHOTO_WIDTH까지 줄인다. 이미 그보다 작으면 원본을 그대로 둔다(괜히 다시 구워서
  // 화질만 깎을 이유가 없다). JPEG로 굽기 전에 흰색을 깔아두는 건, 투명한 PNG(캡처 이미지 등)를
  // 그냥 JPEG로 바꾸면 투명한 자리가 검게 나오기 때문이다 — 페이지 바탕이 흰색이라 흰색이 맞다.
  const shrinkPhotoDataUrl = async (dataUrl: string): Promise<string> => {
    try {
      const img = await loadImage(dataUrl);
      if (!img.naturalWidth || img.naturalWidth <= MAX_PHOTO_WIDTH) return dataUrl;
      const scale = MAX_PHOTO_WIDTH / img.naturalWidth;
      const canvas = document.createElement('canvas');
      canvas.width = MAX_PHOTO_WIDTH;
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
    } catch {
      // 줄이지 못했다고 사진을 못 올리게 할 이유는 없다 — 원본 그대로 넣는다.
      return dataUrl;
    }
  };

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
    if (!draggedId || !targetId) return;
    // 김치 템플릿은 사진이 섹션에 묶여 있어서(photoSectionMap) 전역 배열만 재정렬하면 화면이
    // 그대로인 것처럼 보인다 — 옮긴 사진의 소속 섹션까지 목적지에 맞춰줘야 실제로 자리가 바뀐다.
    if (isKimchi) {
      const targetSectionId = photoSectionMap[targetId];
      if (targetSectionId) movePhotoToSection(draggedId, targetSectionId, targetId);
      return;
    }
    reorderPhotos(draggedId, targetId);
  };

  const handlePhotoPointerUp = () => endPhotoDrag();
  const handlePhotoPointerCancel = () => endPhotoDrag();

  // 툴바를 거치며 선택이 풀렸으면 저장해둔 범위를 되살린다.
  const restoreSelection = (): Range | null => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) return sel.getRangeAt(0);
    const saved = savedRangeRef.current;
    if (!saved || !sel) return null;
    sel.removeAllRanges();
    sel.addRange(saved);
    return saved;
  };

  const editableOfRange = (range: Range): HTMLElement | null => {
    const node = range.commonAncestorContainer;
    const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
    const editable = el?.closest('[contenteditable="true"]') as HTMLElement | null;
    return editable && previewRef.current?.contains(editable) ? editable : null;
  };

  // 고른 범위를 <span style="...">로 감싼다. EditableText는 비제어 DOM이라, 여기서 직접 고친 뒤
  // input 이벤트를 쏘면 그쪽 onInput이 받아서 값으로 저장한다.
  const applyFormatToSelection = (styles: Partial<CSSStyleDeclaration>) => {
    const range = restoreSelection();
    if (!range || range.collapsed) return;
    const editable = editableOfRange(range);
    if (!editable) return;
    const span = document.createElement('span');
    Object.assign(span.style, styles);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch (err) {
      console.error('부분 서식 적용 실패:', err);
      return;
    }
    const sel = window.getSelection();
    const next = document.createRange();
    next.selectNodeContents(span);
    sel?.removeAllRanges();
    sel?.addRange(next);
    savedRangeRef.current = next.cloneRange();
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // 지금 고른 글자의 실제 크기(px)를 읽어서 한 단계씩 키우고 줄인다.
  const scaleSelectionFontSize = (factor: number) => {
    const range = restoreSelection();
    if (!range || range.collapsed) return;
    const node = range.startContainer;
    const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
    if (!el) return;
    const current = parseFloat(window.getComputedStyle(el).fontSize) || 40;
    applyFormatToSelection({ fontSize: `${Math.max(8, Math.round(current * factor))}px` });
  };

  // 고른 범위를 순수 글자로 되돌린다(감싸고 있던 span들이 통째로 사라진다).
  const clearSelectionFormat = () => {
    const range = restoreSelection();
    if (!range || range.collapsed) return;
    const editable = editableOfRange(range);
    if (!editable) return;
    const text = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    setFormatBar(null);
  };

  // 우클릭한 높이가 어느 섹션인지 찾는다. 커서가 섹션 안이면 그 섹션이고, 섹션과 섹션 사이의
  // 빈 여백이면 그 아래에 오는 섹션이다(맨 아래 여백이면 마지막 섹션). 여백에서 우클릭했다고
  // 메뉴가 안 뜨면 "여기 넣고 싶다"는 자리가 오히려 많이 빠진다.
  const sectionIdAtPoint = (target: HTMLElement, clientY: number): string | undefined => {
    const inside = target.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
    if (inside) return inside;
    const els: HTMLElement[] = Array.from(previewRef.current?.querySelectorAll<HTMLElement>('[data-section-id]') ?? []);
    const below = els.find(el => clientY <= el.getBoundingClientRect().bottom);
    return (below ?? els[els.length - 1])?.dataset.sectionId;
  };

  // 미리보기 우클릭: 커서가 놓인 자리를 "몇 번째 사진 앞"으로 옮긴다. 사진 위쪽 절반이면 그 사진
  // 앞에, 아래쪽 절반이면 그다음 사진 앞에(=바로 뒤에) 넣는다. 사진이 아니라 문구나 빈 여백을
  // 눌렀어도, 커서보다 아래에 있는 첫 사진 앞에 끼워 넣어 "지금 보고 있는 자리"에 들어가게 한다.
  //
  // 김치 템플릿은 사진을 섹션별로 나눠 담으므로 섹션 id까지 함께 정하고, 기본 템플릿은 사진
  // 순서 하나뿐이라 섹션 없이 순서만 정한다.
  const handlePreviewContextMenu = (e: React.MouseEvent) => {
    if (brushMode || drawMode || textMode) return;
    const target = e.target as HTMLElement;
    const sectionId = isKimchi ? sectionIdAtPoint(target, e.clientY) : undefined;
    if (isKimchi && !sectionId) return;
    e.preventDefault();

    // 순서를 정할 때 보는 사진 목록. 김치는 그 섹션 것만, 기본 템플릿은 미리보기 전체.
    const scope = (sectionId && previewRef.current?.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`))
      || previewRef.current;
    const photoEls: HTMLElement[] = Array.from(scope?.querySelectorAll<HTMLElement>('[data-photo-id]') ?? []);
    const beforeEl = photoEls.find(el => {
      const rect = el.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    let beforePhotoId = beforeEl?.dataset.photoId;
    // 인증 섹션은 올린 사진 중 첫 장만 가운데 로고로 쓴다. 뒤에 붙이면 어디에도 안 보이므로
    // 늘 맨 앞에 넣어, 우클릭해서 고른 사진이 곧바로 로고가 되게 한다.
    if (sectionId && kimchiSections.find(sec => sec.id === sectionId)?.kind === 'cert') {
      beforePhotoId = photosBySection[sectionId]?.[0]?.id;
    }
    setPhotoInsertTarget({ sectionId, beforePhotoId, left: e.clientX, top: e.clientY });
  };

  const insertPhotosAtTarget = (files: File[]) => {
    if (!photoInsertTarget || files.length === 0) return;
    addPhotoFiles(files, photoInsertTarget.sectionId, photoInsertTarget.beforePhotoId);
    setPhotoInsertTarget(null);
  };

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

  // 김치 템플릿용 프롬프트/붙여넣기. 라벨 체계가 기본 템플릿과 달라서 빌더·파서를 따로 쓴다
  // (utils/kimchiDetailTemplate.ts). 상품 정보 없이도 동작하므로 product를 요구하지 않는다.
  const handleCopyKimchiPrompt = async () => {
    const prompt = buildKimchiCopyPrompt(kimchiSections, {
      productName: kimchiSections.find(s => s.kind === 'hero')?.productName || product?.productName || '',
      sellingPoints,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopyStatus('copied');
      setTimeout(() => setPromptCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('프롬프트 복사 실패:', err);
      alert('클립보드 복사에 실패했어요. 아래 텍스트를 직접 선택해서 복사해주세요.');
    }
  };

  const handleApplyKimchiPasted = () => {
    if (!kimchiPastedText.trim()) return;
    // 라벨은 현재 섹션 구성에서 만들어지므로(buildKimchiCopyPrompt와 같은 함수), 섹션을 바꿨으면
    // 프롬프트도 다시 복사해서 새 라벨로 받아와야 한다.
    const { sections: parsed, filledCount, unknownLabels } = parseKimchiCopyText(kimchiPastedText, kimchiSections);
    if (filledCount === 0) {
      alert('붙여넣은 글에서 문구를 찾지 못했어요. "AI용 프롬프트 복사하기"로 받은 라벨이 그대로 있는지 확인해주세요.');
      return;
    }
    setKimchiSections(parsed);
    // 못 알아본 라벨은 어디에도 넣지 않았다(그냥 앞 항목에 붙이면 그 글자가 이미지에 찍힌다).
    // 어떤 줄이 빠졌는지 알려줘서 라벨만 고쳐 다시 붙여넣을 수 있게 한다.
    if (unknownLabels.length > 0) {
      alert(
        '아래 줄은 라벨로 알아보지 못해서 넣지 않았어요.\n' +
        '섹션이 아직 없어서일 수 있어요 — 예를 들어 "소구점 02"를 쓰려면 소구점 섹션을 먼저 ⧉로 복사해 두어야 합니다.\n\n' +
        unknownLabels.map(l => `· ${l}`).join('\n')
      );
    }
  };

  // ── 섹션 목록 조작 ──
  const updateKimchiSection = (id: string, patch: Partial<KimchiSection>) => {
    setKimchiSections(prev => prev.map(section => (section.id === id ? { ...section, ...patch } : section)));
  };

  const moveKimchiSectionBy = (id: string, direction: -1 | 1) => {
    setKimchiSections(prev => moveKimchiSection(prev, id, direction));
  };

  // 섹션을 지우면 거기 올린 사진도 같이 없앤다 — 그 사진은 다른 섹션에서 닿을 방법이 없다.
  const removeKimchiSectionById = (id: string) => {
    const orphanIds = new Set(
      Object.entries(photoSectionMap).filter(([, sectionId]) => sectionId === id).map(([photoId]) => photoId)
    );
    setKimchiSections(prev => removeKimchiSection(prev, id));
    if (orphanIds.size === 0) return;
    setPhotos(prev => prev.filter(photo => !orphanIds.has(photo.id)));
    setPhotoSectionMap(prev => {
      const next = { ...prev };
      orphanIds.forEach(photoId => delete next[photoId]);
      return next;
    });
  };

  const addKimchiSection = (kind: KimchiSection['kind']) => {
    setKimchiSections(prev => appendKimchiSection(prev, kind));
  };

  const duplicateKimchiSectionById = (id: string) => {
    setKimchiSections(prev => duplicateKimchiSection(prev, id));
  };

  // 패널에서 사진 썸네일을 끌어다 놓았을 때. 섹션 안 순서 바꾸기와 다른 섹션으로 옮기기를 한
  // 동작으로 처리한다 — beforePhotoId가 있으면 그 사진 앞에, 없으면(섹션 빈 자리에 떨어뜨린
  // 경우) 그 섹션 맨 뒤에 놓는다.
  //
  // 섹션별 사진 목록(photosBySection)은 photos 배열의 순서를 그대로 따르므로, 전역 배열에서
  // 자리만 옮겨주면 섹션 안 순서도 그대로 맞는다.
  const movePhotoToSection = (photoId: string, sectionId: string, beforePhotoId?: string) => {
    if (photoId === beforePhotoId) return;
    setPhotoSectionMap(prev => (prev[photoId] === sectionId ? prev : { ...prev, [photoId]: sectionId }));
    setPhotos(prev => {
      const moving = prev.find(p => p.id === photoId);
      if (!moving) return prev;
      const rest = prev.filter(p => p.id !== photoId);
      if (beforePhotoId) {
        const idx = rest.findIndex(p => p.id === beforePhotoId);
        return idx === -1 ? [...rest, moving] : [...rest.slice(0, idx), moving, ...rest.slice(idx)];
      }
      let lastIdx = -1;
      rest.forEach((p, i) => {
        if (photoSectionMap[p.id] === sectionId) lastIdx = i;
      });
      return lastIdx === -1 ? [...rest, moving] : [...rest.slice(0, lastIdx + 1), moving, ...rest.slice(lastIdx + 1)];
    });
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

  // 세로로 긴 캔버스를 sliceHeight 높이로 잘라 여러 장으로 만든다. 자르는 기준은 "저장되는
  // 이미지의 세로 픽셀"이라, 잘린 파일 한 장은 항상 sliceHeight 이하가 된다.
  const sliceCanvasVertically = (source: HTMLCanvasElement, sliceHeight: number): HTMLCanvasElement[] => {
    if (source.height <= sliceHeight) return [source];
    const slices: HTMLCanvasElement[] = [];
    for (let top = 0; top < source.height; top += sliceHeight) {
      const height = Math.min(sliceHeight, source.height - top);
      const target = document.createElement('canvas');
      target.width = source.width;
      target.height = height;
      const ctx = target.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height);
      }
      slices.push(target);
    }
    return slices;
  };

  // 조각들을 이미지로 굽는다. 배율과 품질은 조각마다 따로 정하지 않고 전부 같은 값을 쓴다 —
  // 조각마다 다르게 구우면 가로 폭이 어긋나서 위아래로 이어 붙였을 때 단이 진다.
  // 어떤 값을 쓸지는 가장 무거운 조각 하나로 정하고(모든 조각을 매번 다시 굽지 않으려고),
  // 정해진 값을 전 조각에 똑같이 적용한다. 용량 한도는 파일 한 장 기준이라, 잘라서 저장하면
  // 한 장으로 저장할 때보다 화질을 덜 깎아도 된다.
  //
  // 줄이는 순서가 중요하다: **해상도를 깎는 건 맨 마지막**이다. 사진이 몇 장만 들어가도 2배로
  // 찍은 PNG 한 조각(1720×3000)은 10MB를 훌쩍 넘는데, 여기서 PNG를 고집하며 해상도부터 내리면
  // 1x(860px)까지 떨어져 글자가 눈에 띄게 흐려진다. 같은 조각을 JPEG 고품질로 구우면 해상도를
  // 그대로 두고도 보통 1~2MB에 들어간다 — 사진이 섞인 상세페이지에서는 JPEG 쪽이 늘 이긴다.
  const encodeSlices = (slices: HTMLCanvasElement[], minScale: number): string[] => {
    const fits = (url: string) => dataUrlByteSize(url) <= MAX_DETAIL_IMAGE_BYTES;
    // 0.85 아래로는 김치 템플릿처럼 큰 단색 글자에서 테두리가 지저분해지므로 거기서 멈추고
    // 해상도 쪽을 건드린다.
    const qualitySteps = [0.95, 0.92, 0.9, 0.87, 0.85];

    const pngs = slices.map(c => c.toDataURL('image/png'));
    if (pngs.every(fits)) return pngs;

    const probe = slices[pngs.reduce((worst, url, i) => (dataUrlByteSize(url) > dataUrlByteSize(pngs[worst]) ? i : worst), 0)];

    // 1) 찍은 해상도 그대로, JPEG 품질만 낮춰본다. 대개 여기서 끝난다.
    for (const quality of qualitySteps) {
      if (fits(probe.toDataURL('image/jpeg', quality))) {
        return slices.map(c => c.toDataURL('image/jpeg', quality));
      }
    }

    // 2) 그래도 안 들어가면 해상도를 10%씩 내리며 다시 품질을 훑는다. 화면 표시 배율(1x)까지는
    //    내려도 눈에 보이는 해상도는 유지된다.
    let scale = 1;
    while (scale > minScale) {
      scale = Math.max(minScale, scale * 0.9);
      const scaledProbe = downscaleCanvas(probe, scale);
      for (const quality of qualitySteps) {
        if (fits(scaledProbe.toDataURL('image/jpeg', quality))) {
          return slices.map(c => downscaleCanvas(c, scale).toDataURL('image/jpeg', quality));
        }
      }
    }

    // 3) 1x로도 안 들어가는 극단적인 경우에만 표시 배율 아래로 내려간다.
    const lastResortQualities = [0.8, 0.75, 0.7, 0.6];
    let jpegScale = minScale;
    while (true) {
      const scaledProbe = downscaleCanvas(probe, jpegScale);
      for (const quality of lastResortQualities) {
        if (fits(scaledProbe.toDataURL('image/jpeg', quality))) {
          return slices.map(c => downscaleCanvas(c, jpegScale).toDataURL('image/jpeg', quality));
        }
      }
      if (jpegScale <= 0.15) {
        return slices.map(c => downscaleCanvas(c, jpegScale).toDataURL('image/jpeg', lastResortQualities[lastResortQualities.length - 1]));
      }
      jpegScale *= 0.85;
    }
  };

  // 캡처가 통째로 비었는지(= 전부 흰색) 본다. 캔버스를 작게 줄여 찍어보고 흰색이 아닌 화소가
  // 하나라도 있으면 내용이 있는 것으로 친다. 흰 이미지가 조용히 저장돼 나가는 일만은 막는다.
  const isCanvasBlank = (canvas: HTMLCanvasElement): boolean => {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, probe.width, probe.height);
    try {
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
      }
      return true;
    } catch {
      // 화소를 읽지 못했으면(외부 이미지로 오염된 캔버스 등) 비었다고 단정하지 않는다.
      return false;
    }
  };

  // 띠 여러 장을 한 캔버스로 이어 붙인다. 상품등록에서 여는 상세페이지는 제안서·통합다운이
  // "상세이미지 한 장"을 전제로 돌아가서 자를 수가 없다. 이어 붙인 크기가 한계를 넘으면 넘지
  // 않는 선까지 배율을 낮춘다 — 조금 흐려질지언정 흰 이미지가 나가지는 않는다.
  const mergeBands = (bands: HTMLCanvasElement[]): HTMLCanvasElement => {
    if (bands.length === 1) return bands[0];
    const width = bands[0].width;
    const height = bands.reduce((sum, b) => sum + b.height, 0);
    const fit = Math.min(
      1,
      MAX_CANVAS_SIDE / height,
      MAX_CANVAS_SIDE / width,
      Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    );
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(width * fit));
    target.height = Math.max(1, Math.round(height * fit));
    const ctx = target.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 위치를 반올림하면 띠 사이에 1px 흰 줄이 생기므로 소수점 그대로 그린다.
      let top = 0;
      for (const band of bands) {
        ctx.drawImage(band, 0, top * fit, target.width, band.height * fit);
        top += band.height;
      }
    }
    return target;
  };

  // 완성된 페이지를 저장용 이미지로 만든다. 페이지가 MAX_SLICE_HEIGHT보다 길면 여러 장으로
  // 잘려 나오고, 짧으면 한 장짜리 배열이 나온다.
  const captureSlices = async (): Promise<string[] | null> => {
    setIsExporting(true);
    try {
      const bands = await captureBands();
      if (!bands || bands.length === 0) return null;
      if (bands.every(isCanvasBlank)) {
        alert('상세페이지를 찍었는데 내용이 비어 있습니다. 사진이 다 뜬 뒤에 다시 저장해주세요.');
        return null;
      }
      // 자르는 건 헤더 "상페작업"으로 여는 독립 상세페이지(김치)뿐이다. 상품등록에서 여는 쪽은
      // 제안서·통합다운이 상세이미지 한 장을 전제로 돌아가므로 예전처럼 한 장으로 낸다.
      const slices = isKimchi
        ? bands.flatMap(band => sliceCanvasVertically(band, MAX_SLICE_HEIGHT))
        : [mergeBands(bands)];
      // 1x 아래로는 내리지 않는다 — 화면에 보이는 해상도보다 흐려지는 일은 없게.
      const minScale = Math.min(1, CANVAS_WIDTH / slices[0].width);
      const dataUrls = encodeSlices(slices, minScale);

      const tooBig = dataUrls.filter(url => dataUrlByteSize(url) > MAX_DETAIL_IMAGE_BYTES).length;
      if (tooBig > 0) {
        const limitMb = Math.round(MAX_DETAIL_IMAGE_BYTES / (1024 * 1024));
        alert(`사진 수가 많아 ${tooBig}장을 ${limitMb}MB 이하로 줄이지 못했습니다. 사진 수를 줄이거나 나눠서 저장해주세요.`);
      }
      return dataUrls;
    } catch (error) {
      console.error(error);
      alert('상세페이지 이미지를 만드는 중 오류가 발생했습니다.');
      return null;
    } finally {
      setIsExporting(false);
    }
  };


  // 붙여넣기 파싱이 실패했거나(라벨 형식이 조금 달라서) 문구를 하나도 입력하지 않은 채로 그대로
  // 저장/다운로드해버리는 걸 막는 마지막 안전장치 — 문구가 전부 빈칸이면 저장 직전에 한 번 확인한다.
  const confirmIfCopyEmpty = () => {
    const isEmpty = isKimchi
      ? !kimchiHasContent
      : !copy.productName.trim() && !copy.hookCopy.trim() &&
        copy.highlights.every(h => !h.trim()) && copy.features.length === 0 && !copy.closing.trim();
    if (!isEmpty) return true;
    return window.confirm(
      isKimchi
        ? '문구가 하나도 입력되지 않았어요. 사진만으로 이대로 저장할까요?'
        : '제품명/후킹 문구/특별한점/특징/마무리 문구가 전부 비어 있어요. 이대로 저장할까요?'
    );
  };

  const handleDownload = async () => {
    if (!confirmIfCopyEmpty()) return;
    const dataUrls = await captureSlices();
    if (!dataUrls || dataUrls.length === 0) return;
    const baseName = product?.detailFile || `${product?.productName || 'detail_page'}.png`;
    const names = detailSliceFileNames(baseName, dataUrls);
    // 여러 장이어도 폴더 선택은 한 번만 받도록 한꺼번에 넘긴다.
    const files = await Promise.all(
      dataUrls.map(async (url, idx) => ({ name: names[idx], blob: await (await fetch(url)).blob() }))
    );
    await saveFilesInProductFolder(productFolderName(product), files);
  };

  // 사진에 별(★)을 눌러 대표이미지를 지정하지 않은 채로 저장하면, 통합다운 때 대표이미지가
  // 빠진 채로 나간다. 저장 직전에 한 번 짚어준다.
  const confirmIfThumbnailMissing = () => {
    const targets = groupProducts.length > 0 ? groupProducts : (product ? [product] : []);
    const missing = targets.filter(p => !p.thumbnailDataUrl);
    if (missing.length === 0) return true;

    const message = targets.length > 1
      ? `대표이미지가 지정되지 않은 옵션이 ${missing.length}개 있습니다.\n(${missing.map(p => p.color || p.productName || '옵션').join(', ')})\n\n사진의 ★를 눌러 지정할 수 있습니다. 이대로 저장할까요?`
      : '대표이미지를 지정하지 않았습니다.\n사진 위의 ★를 눌러 지정할 수 있습니다.\n\n이대로 저장할까요?';
    return window.confirm(message);
  };

  const handleSave = async () => {
    if (!confirmIfThumbnailMissing()) return;
    if (!confirmIfCopyEmpty()) return;
    const dataUrls = await captureSlices();
    if (!dataUrls || dataUrls.length === 0) return;
    // 여러 장으로 잘렸을 때 실제 파일명은 저장할 때 번호를 붙여 만든다(detailSliceFileNames).
    // 여기 detailFile에는 번호 없는 이름 하나만 두되, 용량 때문에 JPEG로 바뀌었으면 확장자는 맞춘다.
    if (product?.detailFile) {
      const fileName = dataUrls[0].startsWith('data:image/jpeg')
        ? product.detailFile.replace(/\.png$/i, '.jpg')
        : product.detailFile;
      if (fileName !== product.detailFile) onSave('detailFile', fileName);
    }
    onSave('detailDataUrls', dataUrls);
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
            {hasRenderableContent && (
              <div className="flex items-center justify-between gap-1.5 flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  {photos.length > 0 && (
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
                  )}
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
                  <button
                    onClick={toggleTextMode}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-xs font-semibold transition-colors ${
                      textMode
                        ? 'bg-sky-600 border-sky-500 text-white hover:bg-sky-500'
                        : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <TextToolIcon className="h-3.5 w-3.5" />
                    {textMode ? '텍스트 모드 종료' : '텍스트 추가'}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {selectedPhotosOrdered.length > 0 && !brushMode && !drawMode && !textMode && (
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
                    { tool: 'label' as DrawTool, label: '글상자', Icon: TextToolIcon },
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
                {drawTool === 'label' ? (
                  // 글상자 편집 패널. 미리보기에서 글상자를 누르면 여기서 글자·각도·크기·색을 바꾼다.
                  selectedLabel ? (
                    <div className="space-y-2 rounded-md border border-slate-600 bg-slate-800/60 p-2">
                      <textarea
                        value={selectedLabel.text}
                        onChange={e => updateSelectedLabel({ text: e.target.value })}
                        rows={2}
                        placeholder="문구 (줄바꿈 가능)"
                        className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-100 placeholder:text-slate-600 resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-10 flex-shrink-0">각도</span>
                        <input
                          type="range"
                          min={-90}
                          max={90}
                          value={selectedLabel.angle}
                          onChange={e => updateSelectedLabel({ angle: Number(e.target.value) })}
                          className="flex-1"
                        />
                        <span className="text-xs text-slate-400 w-10 text-right tabular-nums">{selectedLabel.angle}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-10 flex-shrink-0">크기</span>
                        <input
                          type="range"
                          min={16}
                          max={140}
                          value={selectedLabel.fontSize}
                          onChange={e => updateSelectedLabel({ fontSize: Number(e.target.value) })}
                          className="flex-1"
                        />
                        <span className="text-xs text-slate-400 w-10 text-right tabular-nums">{selectedLabel.fontSize}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-slate-400">
                          글자
                          <input
                            type="color"
                            value={selectedLabel.color}
                            onChange={e => updateSelectedLabel({ color: e.target.value })}
                            className="w-7 h-6 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-slate-400">
                          배경
                          <input
                            type="color"
                            value={selectedLabel.background === 'transparent' ? '#c9342a' : selectedLabel.background}
                            onChange={e => updateSelectedLabel({ background: e.target.value })}
                            className="w-7 h-6 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                          />
                        </label>
                        <button
                          onClick={() =>
                            updateSelectedLabel({
                              background: selectedLabel.background === 'transparent' ? drawColor : 'transparent',
                            })
                          }
                          className="px-2 h-6 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-[11px]"
                        >
                          {selectedLabel.background === 'transparent' ? '배경 켜기' : '배경 끄기'}
                        </button>
                        <button
                          onClick={deleteSelectedLabel}
                          className="px-2 h-6 rounded bg-slate-700 text-slate-300 hover:bg-red-600 hover:text-white transition-colors text-[11px]"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 leading-relaxed rounded-md border border-slate-600 bg-slate-800/60 p-2">
                      미리보기에서 원하는 자리를 클릭하면 글상자가 생겨요. 만들어진 글상자를 눌러 고르면
                      글자·각도·색을 바꾸고, 그대로 끌어서 옮길 수 있습니다.
                    </p>
                  )
                ) : (
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
                )}
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

            {textMode && (
              <div className="flex-shrink-0 flex flex-col gap-2 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  미리보기의 원하는 자리를 <strong className="text-slate-200">클릭하면 그 자리에 문구를 입력</strong>할 수 있어요.
                  박스는 드래그로 이동, 한 번 더 클릭하면 다시 수정돼요. 입력한 문구는 저장/다운로드 시 그대로 포함돼요.
                </p>
                {selectedTextBox ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-10 flex-shrink-0">폰트</span>
                      <select
                        value={selectedTextBox.fontFamily}
                        onChange={e => updateTextBox(selectedTextBox.id, { fontFamily: e.target.value })}
                        className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100"
                      >
                        {FONT_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-10 flex-shrink-0">크기</span>
                      <input
                        type="range"
                        min={TEXT_BOX_FONT_SIZE_MIN}
                        max={TEXT_BOX_FONT_SIZE_MAX}
                        value={selectedTextBox.fontSize}
                        onChange={e => updateTextBox(selectedTextBox.id, { fontSize: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{selectedTextBox.fontSize}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-400 w-10 flex-shrink-0">색상</span>
                      <input
                        type="color"
                        value={selectedTextBox.color}
                        onChange={e => updateTextBox(selectedTextBox.id, { color: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                      />
                      <button
                        onClick={() => updateTextBox(selectedTextBox.id, { bold: !selectedTextBox.bold })}
                        className={`w-8 h-8 text-sm font-bold rounded-md border ${
                          selectedTextBox.bold ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                        }`}
                      >
                        B
                      </button>
                      <button
                        onClick={() => updateTextBox(selectedTextBox.id, { italic: !selectedTextBox.italic })}
                        className={`w-8 h-8 text-sm italic rounded-md border ${
                          selectedTextBox.italic ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                        }`}
                      >
                        I
                      </button>
                      <div className="flex items-center gap-1">
                        {(['left', 'center', 'right'] as const).map(align => (
                          <button
                            key={align}
                            onClick={() => updateTextBox(selectedTextBox.id, { align })}
                            className={`px-2 h-8 text-xs rounded-md border ${
                              selectedTextBox.align === align ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                            }`}
                          >
                            {align === 'left' ? '왼쪽' : align === 'center' ? '가운데' : '오른쪽'}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => removeTextBox(selectedTextBox.id)}
                        className="ml-auto flex items-center gap-1 px-2.5 h-8 text-xs text-red-400 hover:bg-red-500/10 rounded-md transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5"
                      >
                        <TrashIcon /> 삭제
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {textBoxes.length > 0 ? '문구 박스를 클릭하면 폰트·크기·색상을 조절할 수 있어요.' : '아직 추가한 문구가 없어요.'}
                  </p>
                )}
              </div>
            )}
            <div className="flex-1 min-w-0 bg-slate-950/60 rounded-xl border border-slate-700 p-4 min-h-[320px] max-h-[70vh] overflow-auto flex justify-center items-start">
            {!hasRenderableContent ? null : (
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
              <div
                ref={previewRef}
                onContextMenu={handlePreviewContextMenu}
                style={{ width: CANVAS_WIDTH, backgroundColor: '#ffffff', position: 'relative' }}
              >
                {isKimchi ? (
                  React.createElement(
                    kimchiSkin === 'modern' ? KimchiPreviewModern
                      : kimchiSkin === 'bold' ? KimchiPreviewBold
                      : kimchiSkin === 'sales' ? KimchiPreviewSales
                      : KimchiPreview,
                    {
                    sections: kimchiSections,
                    updateSection: updateKimchiSection,
                    photosBySection,
                    renderPhoto,
                    fontFamily: templateStyle.fontFamily,
                    textColor: templateStyle.textColor,
                    fontScale: templateStyle.fontScale,
                    typeScale: kimchiTypeScale,
                    accentColor: kimchiAccent,
                    }
                  )
                ) : (
                  <>
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
                  </>
                )}

                {/* Persistent paint layer — lives inside previewRef (unlike the erase-brush mask
                    below) so html2canvas bakes it into the exported/saved image. Always mounted once
                    there are photos so drawings stay visible after leaving draw mode; pointer events
                    only engage while drawMode is on. */}
                <canvas
                  ref={drawCanvasRef}
                  className="absolute inset-0"
                  style={{ width: '100%', height: '100%', pointerEvents: drawMode ? 'auto' : 'none', cursor: !drawMode ? 'default' : drawTool === 'label' ? 'crosshair' : 'none' }}
                  onPointerDown={handleDrawPointerDown}
                  onPointerMove={handleDrawPointerMove}
                  onPointerUp={handleDrawPointerUp}
                  onPointerLeave={handleDrawPointerLeave}
                />

                {/* Free text boxes — always mounted so they render into the exported image; only
                    interactive (place / drag / edit) while textMode is on. */}
                <div className="absolute inset-0" style={{ pointerEvents: textMode ? 'auto' : 'none' }}>
                  {textMode && (
                    <div
                      data-html2canvas-ignore="true"
                      className="absolute inset-0"
                      style={{ cursor: 'text' }}
                      onClick={handleTextStageClick}
                    />
                  )}
                  {textBoxes.map(box => {
                    const selected = textMode && selectedTextBoxId === box.id;
                    const editing = editingTextBoxId === box.id;
                    return (
                      <div
                        key={box.id}
                        className="absolute"
                        style={{
                          left: `${box.xPct}%`,
                          top: `${box.yPct}%`,
                          transform: 'translate(-50%, -50%)',
                          maxWidth: CANVAS_WIDTH - PADDING_X * 2,
                        }}
                      >
                        <div
                          ref={el => {
                            if (el) textBoxElRefs.current.set(box.id, el);
                            else textBoxElRefs.current.delete(box.id);
                          }}
                          contentEditable={editing}
                          suppressContentEditableWarning
                          onPointerDown={e => handleTextBoxPointerDown(e, box.id)}
                          onClick={e => handleTextBoxClick(e, box.id)}
                          onBlur={e => handleTextBoxBlur(e, box.id)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              (e.currentTarget as HTMLDivElement).blur();
                            }
                          }}
                          style={{
                            fontFamily: box.fontFamily,
                            fontSize: box.fontSize,
                            color: box.color,
                            fontWeight: box.bold ? 700 : 400,
                            fontStyle: box.italic ? 'italic' : 'normal',
                            textAlign: box.align,
                            lineHeight: 1.3,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            outline: 'none',
                            minWidth: '1ch',
                            minHeight: '1em',
                            padding: '2px 6px',
                            cursor: !textMode ? 'default' : editing ? 'text' : 'move',
                          }}
                        >
                          {box.text}
                        </div>
                        {selected && (
                          <div
                            data-html2canvas-ignore="true"
                            className="absolute inset-0 pointer-events-none"
                            style={{ outline: '2px dashed #38bdf8', outlineOffset: 2 }}
                          />
                        )}
                        {selected && !editing && (
                          <button
                            data-html2canvas-ignore="true"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              removeTextBox(box.id);
                            }}
                            className="absolute -top-3 -right-3 w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded-full text-xs leading-none shadow hover:bg-red-400"
                            title="이 문구 삭제"
                            style={{ fontFamily: 'sans-serif', fontWeight: 700 }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
              {drawMode && drawTool !== 'label' && drawCursorPos && (
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
            {isKimchi ? (
              <>
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">디자인</p>
                <div className="flex gap-1.5">
                  {([
                    { id: 'basic' as const, label: '기본', hint: '굵고 꽉 찬 컬러 블록, 가운데 정렬' },
                    { id: 'modern' as const, label: '모던', hint: '여백 넓은 왼쪽 정렬, 얇은 선' },
                    { id: 'bold' as const, label: '컬러', hint: '둥근 색 상자, 배지, 좌우 번갈이 배치' },
                    { id: 'sales' as const, label: '체크포인트', hint: '배지·말풍선·색 채운 인증 패널의 설득형 구성' },
                  ]).map(skin => (
                    <button
                      key={skin.id}
                      onClick={() => setKimchiSkin(skin.id)}
                      title={skin.hint}
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                        kimchiSkin === skin.id
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {skin.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  문구와 사진은 그대로 두고 디자인만 바뀝니다. 붙여넣기 라벨도 같아요.
                </p>
                {/* 시그니처 색은 템플릿마다 따로 기억한다 — 디자인을 바꾸면 그 템플릿에서 고른
                    색으로 돌아온다. 섹션에서 색을 따로 지정하면 그 섹션만 예외가 된다. */}
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-400 flex-shrink-0">시그니처 색</span>
                  {['#d4462a', '#c2410c', '#b45309', '#2f9e44', '#2f5d50', '#1e3a5f'].map(color => (
                    <button
                      key={color}
                      onClick={() => setKimchiAccents(prev => ({ ...prev, [kimchiSkin]: color }))}
                      title={color}
                      className={`w-5 h-5 rounded-full flex-shrink-0 transition-transform ${
                        kimchiAccent === color ? 'ring-2 ring-white scale-110' : 'border border-slate-600'
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                  <label
                    title="색 직접 고르기"
                    className="w-5 h-5 rounded-full flex-shrink-0 cursor-pointer border border-slate-600 bg-gradient-to-br from-pink-400 via-yellow-300 to-sky-400"
                  >
                    <input
                      type="color"
                      value={kimchiAccent}
                      className="sr-only"
                      onChange={e => setKimchiAccents(prev => ({ ...prev, [kimchiSkin]: e.target.value }))}
                    />
                  </label>
                </div>
              </div>
              <KimchiSectionPanel
                sections={kimchiSections}
                photosBySection={photosBySection}
                updateSection={updateKimchiSection}
                moveSection={moveKimchiSectionBy}
                removeSection={removeKimchiSectionById}
                addSection={addKimchiSection}
                duplicateSection={duplicateKimchiSectionById}
                templateAccent={kimchiAccent}
                movePhoto={movePhotoToSection}
                onAddFiles={(sectionId, files) => addPhotoFiles(files, sectionId)}
                onRemovePhoto={removePhoto}
                onPhotoClick={photo => startCropQueue([photo])}
                defaultSectionGap={KIMCHI_SKIN_SECTION_GAP[kimchiSkin]}
                setAllSectionGaps={gap => setKimchiSections(prev => prev.map(sec => ({ ...sec, sectionGap: gap })))}
              />
              </>
            ) : (
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
              </div>
            )}

            {isKimchi ? (
              <div className="space-y-2 pt-2 border-t border-slate-700">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">문구 붙여넣기</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  프롬프트를 복사해 ChatGPT 등에 넣고, 받은 답변을 통째로 아래에 붙여넣으면 섹션별로 채워져요.
                </p>
                <button
                  onClick={handleCopyKimchiPrompt}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-700 text-slate-100 font-semibold rounded-lg hover:bg-slate-600 transition-colors"
                >
                  {promptCopyStatus === 'copied' ? '복사됨!' : 'AI용 프롬프트 복사하기'}
                </button>
                <button
                  onClick={handleApplyKimchiPasted}
                  disabled={!kimchiPastedText.trim()}
                  className="w-full px-3 py-2 text-sm bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  붙여넣은 문구 적용
                </button>
                <textarea
                  value={kimchiPastedText}
                  onChange={e => setKimchiPastedText(e.target.value)}
                  placeholder="여기에 문구를 붙여넣으세요"
                  rows={10}
                  className="w-full px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100 placeholder:text-slate-500 resize-none"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  적용한 뒤에도 미리보기에서 글자를 직접 눌러 고칠 수 있어요. 비워둔 항목은 이미지에서 빠집니다.
                </p>
              </div>
            ) : (
              <div className="space-y-2 pt-2 border-t border-slate-700">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">문구 직접 붙여넣기</p>
                <button
                  onClick={handleCopyPrompt}
                  disabled={photos.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-700 text-slate-100 font-semibold rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {promptCopyStatus === 'copied' ? '복사됨!' : 'AI용 프롬프트 복사하기'}
                </button>
                <button
                  onClick={handleApplyPasted}
                  disabled={!pastedText.trim()}
                  className="w-full px-3 py-2 text-sm bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  붙여넣은 문구 적용
                </button>
                <textarea
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  placeholder="여기에 문구를 붙여넣거나 직접 입력하세요"
                  rows={10}
                  className="w-full px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-100 placeholder:text-slate-500 resize-none"
                />
              </div>
            )}

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
              {/* 글자 단계 — 김치 템플릿 전용. 위의 "글씨크기"는 페이지 전체를 한 번에 늘리고
                  줄이는 배율이고, 이쪽은 단계끼리의 차이(대제목이 본문보다 얼마나 큰지)를 정한다. */}
              {isKimchi && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">글자 단계</span>
                    <button
                      onClick={() => setKimchiTypeScale(KIMCHI_TYPE_SCALE)}
                      disabled={KIMCHI_TYPE_STEPS.every(step => kimchiTypeScale[step.key] === KIMCHI_TYPE_SCALE[step.key])}
                      title="다섯 단계를 기본값으로 되돌립니다"
                      className="px-1.5 h-6 rounded bg-slate-800 border border-slate-600 text-slate-400 hover:bg-slate-700 transition-colors text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      기본값
                    </button>
                  </div>
                  {KIMCHI_TYPE_STEPS.map(step => (
                    <div key={step.key} className="flex items-center gap-2" title={`${step.label} — ${step.hint}`}>
                      <span className="text-[11px] text-slate-500 w-12 flex-shrink-0">{step.label}</span>
                      <input
                        type="range"
                        min={step.min}
                        max={step.max}
                        step={1}
                        value={kimchiTypeScale[step.key]}
                        onChange={e => setKimchiTypeScale(prev => ({ ...prev, [step.key]: Number(e.target.value) }))}
                        className="flex-1 min-w-0 accent-blue-500 cursor-pointer"
                      />
                      <input
                        type="number"
                        min={step.min}
                        max={step.max}
                        value={kimchiTypeScale[step.key]}
                        onChange={e => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next)) return;
                          setKimchiTypeScale(prev => ({
                            ...prev,
                            [step.key]: Math.min(step.max, Math.max(step.min, Math.round(next))),
                          }));
                        }}
                        className="w-12 flex-shrink-0 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[11px] text-slate-200 text-right tabular-nums"
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    이 다섯 개가 김치 상세페이지에 쓰는 글자 크기 전부입니다. 단계를 옮기면 그 단계를
                    쓰는 문구가 모두 함께 움직여요 (마우스를 올리면 어디에 쓰이는지 보입니다).
                  </p>
                </div>
              )}
              {/* 개수 조절은 기본 템플릿 전용 — 김치 템플릿은 섹션 구성이 고정이고, 비워둔 항목이
                  알아서 빠지는 방식이라 개수를 따로 정할 필요가 없다. */}
              {!isKimchi && (
                <>
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
                </>
              )}
            </div>

            {/* AI 문구생성은 기본 템플릿의 문구 구조(특별한점/특징 01~)로만 생성돼서 김치 템플릿에는
                맞지 않는다. 김치는 위의 "문구 붙여넣기"에 있는 전용 프롬프트를 쓴다. */}
            {!isKimchi && (
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
            )}

          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4 border-t border-slate-700">
          {isKimchi && (
            <>
              <span className="mr-auto text-xs text-slate-500">
                {draftSavedAt
                  ? `작업 내용이 이 컴퓨터에 저장됨 · ${new Date(draftSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
                  : '작업 내용은 이 컴퓨터에 자동 저장됩니다'}
              </span>
              <button
                onClick={handleResetKimchiDraft}
                className="px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
              >
                새로 시작
              </button>
            </>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-600 transition-colors">
            닫기
          </button>
          <button
            onClick={handleDownload}
            disabled={!hasRenderableContent || isExporting}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isExporting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <DownloadIcon />} 다운로드
          </button>
          <button
            onClick={handleSave}
            disabled={!hasRenderableContent || isExporting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExporting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <SaveIcon />} 상세 이미지로 저장
          </button>
        </div>
      </div>
      {/* 미리보기에서 우클릭한 자리에 사진을 끼워 넣는 작은 메뉴. 파일을 고르거나, 메뉴에 포커스를
          둔 채 Ctrl+V(⌘V)로 클립보드 이미지를 바로 넣을 수 있다. */}
      {photoInsertTarget && (
        <>
          <div className="fixed inset-0 z-[88]" onClick={() => setPhotoInsertTarget(null)} onContextMenu={e => e.preventDefault()} />
          <div
            data-html2canvas-ignore="true"
            onClick={e => e.stopPropagation()}
            className="fixed z-[89] rounded-lg bg-slate-900 border border-slate-600 shadow-xl p-2 space-y-1.5"
            style={{
              left: Math.min(photoInsertTarget.left, window.innerWidth - 220),
              // 미리보기 아래쪽에서 우클릭하면 메뉴가 화면 밖으로 밀려나므로 위로 끌어올린다.
              top: Math.max(8, Math.min(photoInsertTarget.top, window.innerHeight - 130)),
            }}
          >
            <label
              tabIndex={0}
              onPaste={(e: React.ClipboardEvent) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const files = Array.from(items)
                  .filter((item: DataTransferItem) => item.kind === 'file' && item.type.startsWith('image/'))
                  .map((item: DataTransferItem) => item.getAsFile())
                  .filter((f): f is File => !!f);
                if (files.length === 0) return;
                e.preventDefault();
                insertPhotosAtTarget(files);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-500 cursor-pointer transition-colors"
            >
              <UploadIcon className="h-3.5 w-3.5" /> 여기에 사진 넣기
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={e => {
                  insertPhotosAtTarget(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
            </label>
            <p className="text-[11px] text-slate-500 leading-snug max-w-[190px]">
              클릭해서 파일을 고르거나, 이 버튼을 누른 뒤 Ctrl+V(⌘V)로 붙여넣으세요.
            </p>
          </div>
        </>
      )}

      {/* 드래그로 고른 글자에만 적용되는 서식 툴바. onMouseDown에서 기본 동작을 막아야 클릭하는
          순간 선택이 풀리지 않는다. data-html2canvas-ignore로 저장 이미지에는 안 찍힌다. */}
      {formatBar && (
        <div
          data-html2canvas-ignore="true"
          // 기본 동작을 막아야 툴바를 누르는 순간 선택이 풀리지 않고, 클릭 전파를 막아야 바깥
          // 배경의 onClick(=모달 닫기)까지 올라가지 않는다.
          onMouseDown={e => e.preventDefault()}
          onClick={e => e.stopPropagation()}
          className="fixed z-[90] flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-600 shadow-xl"
          style={{ left: formatBar.left, top: Math.max(8, formatBar.top - 48), transform: 'translateX(-50%)' }}
        >
          {['#1a1a1a', '#ffffff', '#e02020', '#1d4ed8', '#15803d', '#a16207'].map(color => (
            <button
              key={color}
              onClick={() => applyFormatToSelection({ color })}
              title={`글자색 ${color}`}
              className="w-5 h-5 rounded-full border border-slate-500 flex-shrink-0"
              style={{ background: color }}
            />
          ))}
          <label
            title="색 직접 고르기"
            className="w-5 h-5 rounded-full border border-slate-500 flex-shrink-0 cursor-pointer bg-gradient-to-br from-pink-400 via-yellow-300 to-sky-400"
          >
            <input
              type="color"
              className="sr-only"
              onChange={e => applyFormatToSelection({ color: e.target.value })}
            />
          </label>
          <span className="w-px h-5 bg-slate-600 mx-0.5" />
          <button
            onClick={() => scaleSelectionFontSize(0.87)}
            title="글자 작게"
            className="px-1.5 h-6 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-xs"
          >
            A−
          </button>
          <button
            onClick={() => scaleSelectionFontSize(1.15)}
            title="글자 크게"
            className="px-1.5 h-6 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm font-bold"
          >
            A+
          </button>
          <span className="w-px h-5 bg-slate-600 mx-0.5" />
          <button
            onClick={() => applyFormatToSelection({ fontWeight: '700' })}
            title="굵게"
            className="w-6 h-6 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-xs font-bold"
          >
            B
          </button>
          <button
            onClick={() => applyFormatToSelection({ fontWeight: '400' })}
            title="굵기 풀기"
            className="w-6 h-6 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-xs"
          >
            b
          </button>
          <button
            onClick={clearSelectionFormat}
            title="서식 지우기"
            className="w-6 h-6 rounded bg-slate-700 text-slate-300 hover:bg-red-600 hover:text-white transition-colors text-xs"
          >
            ⌫
          </button>
        </div>
      )}

      <ImageCropModal
        isOpen={cropTargets.length > 0}
        images={cropTargets.map(p => ({ id: p.id, dataUrl: p.dataUrl }))}
        onCancel={cancelCropQueue}
        onApply={handleApplyCrop}
      />
    </div>
  );
};

export default DetailPageBuilderModal;
