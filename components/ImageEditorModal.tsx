import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Product } from '../types';
import { editImageWithGemini, BRUSH_ERASE_PROMPT } from '../utils/geminiImageEdit';
import { saveDataUrlInProductFolder, productFolderName } from '../utils/fileSave';
import { generateId } from '../utils/id';
import {
  CloseIcon,
  SpinnerIcon,
  SaveIcon,
  DownloadIcon,
  UndoIcon,
  LayersIcon,
  SparklesIcon,
  TextToolIcon,
  BrushIcon,
  TrashIcon,
  UploadIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from './Icons';

interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onSave: (field: 'thumbnailDataUrl' | 'detailDataUrl', dataUrl: string) => void;
}

type Tab = 'merge' | 'removeText' | 'addText' | 'brush';
type FontFamily = 'Pretendard' | 'Paperlogy';

interface MergeItem {
  id: string;
  dataUrl: string;
}

interface TextLayer {
  id: string;
  text: string;
  xPct: number;
  yPct: number;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  fontFamily: FontFamily;
  align: CanvasTextAlign;
}

interface SelectionRect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

const MERGE_GAP = 50;

const REMOVE_TEXT_PROMPT =
  '이 이미지 안에 있는 모든 텍스트(글자)를 찾아서 자연스럽게 지워줘. 텍스트가 있던 자리는 주변 배경, 패턴, 색상과 자연스럽게 이어지도록 인페인팅해줘. 새로운 텍스트를 추가하지 말고, 텍스트가 없던 나머지 부분은 원본 그대로 최대한 유지해줘. 결과물은 반드시 편집된 이미지여야 해.';

const REMOVE_TEXT_SELECTION_PROMPT =
  '이 이미지에서 형광 분홍색(마젠타) 사각형으로 표시된 영역 안에 있는 텍스트만 찾아서 자연스럽게 지워줘. 표시된 사각형 안의 글자만 제거하고 주변 배경, 패턴, 색상과 자연스럽게 이어지도록 인페인팅해줘. 분홍색 사각형 표시 자체도 완전히 사라져야 해. 사각형 밖의 나머지 부분은 절대 바꾸지 말고 원본 그대로 유지해줘. 결과물은 반드시 편집된 이미지여야 해.';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function clampZoom(z: number) {
  return Math.min(3, Math.max(0.25, Math.round(z * 100) / 100));
}

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ isOpen, onClose, product, onSave }) => {
  const [activeTab, setActiveTab] = useState<Tab>('merge');
  const [canvasDataUrl, setCanvasDataUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displayWidth, setDisplayWidth] = useState(0);
  const [zoom, setZoom] = useState(1);

  const [mergeList, setMergeList] = useState<MergeItem[]>([]);
  const [isMerging, setIsMerging] = useState(false);

  const [removeTextStatus, setRemoveTextStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [removeTextResult, setRemoveTextResult] = useState<string | null>(null);
  const [removeTextError, setRemoveTextError] = useState('');
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);

  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  const [brushSize, setBrushSize] = useState(40);
  const [brushCursorPos, setBrushCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [brushAiStatus, setBrushAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [brushAiResult, setBrushAiResult] = useState<string | null>(null);
  const [brushAiError, setBrushAiError] = useState('');

  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingLayerIdRef = useRef<string | null>(null);
  const dragMovedRef = useRef(false);
  const isPaintingRef = useRef(false);
  const lastPaintPointRef = useRef<{ x: number; y: number } | null>(null);
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const layerElRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!isOpen) return;
    setCanvasDataUrl(null);
    setHistory([]);
    setMergeList([]);
    setActiveTab('merge');
    setZoom(1);
    setTextLayers([]);
    setSelectedLayerId(null);
    setEditingLayerId(null);
    setRemoveTextStatus('idle');
    setRemoveTextResult(null);
    setRemoveTextError('');
    setSelectionRect(null);
    setBrushAiStatus('idle');
    setBrushAiResult(null);
    setBrushAiError('');
  }, [isOpen, product?.id]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDisplayWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasDataUrl, activeTab]);

  useEffect(() => {
    if (activeTab === 'brush' && brushCanvasRef.current && naturalSize.width && naturalSize.height) {
      const canvas = brushCanvasRef.current;
      canvas.width = naturalSize.width;
      canvas.height = naturalSize.height;
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [activeTab, canvasDataUrl, naturalSize]);

  useEffect(() => {
    if (editingLayerId) {
      const el = layerElRefs.current.get(editingLayerId);
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [editingLayerId]);

  const previewScale = naturalSize.width > 0 && displayWidth > 0 ? displayWidth / naturalSize.width : 1;

  const handleImgLoad = () => {
    if (imgRef.current) {
      setNaturalSize({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight });
    }
  };

  const commitCanvas = useCallback((newDataUrl: string) => {
    setHistory(prev => (canvasDataUrl ? [...prev, canvasDataUrl] : prev));
    setCanvasDataUrl(newDataUrl);
  }, [canvasDataUrl]);

  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = copy.pop()!;
      setCanvasDataUrl(last);
      return copy;
    });
  };

  const handleDownload = () => {
    if (!canvasDataUrl) return;
    saveDataUrlInProductFolder(canvasDataUrl, productFolderName(product), `${product?.productName || 'image'}_edited.png`);
  };

  const handleSaveAs = (field: 'thumbnailDataUrl' | 'detailDataUrl') => {
    if (!canvasDataUrl) return;
    onSave(field, canvasDataUrl);
  };

  // --- Zoom ---
  const zoomIn = () => setZoom(z => clampZoom(z + 0.25));
  const zoomOut = () => setZoom(z => clampZoom(z - 0.25));
  const resetZoom = () => setZoom(1);
  const handleWheelZoom = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(z => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)));
  };

  // --- Merge tab ---
  const handleMergeFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setMergeList(prev => [...prev, { id: generateId(), dataUrl: reader.result as string }]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const addExistingToMergeList = (dataUrl?: string) => {
    if (!dataUrl) return;
    setMergeList(prev => [...prev, { id: generateId(), dataUrl }]);
  };

  const moveMergeItem = (id: string, dir: -1 | 1) => {
    setMergeList(prev => {
      const idx = prev.findIndex(i => i.id === id);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  const removeMergeItem = (id: string) => setMergeList(prev => prev.filter(i => i.id !== id));

  const handleMerge = async () => {
    if (mergeList.length === 0) return;
    setIsMerging(true);
    try {
      const images = await Promise.all(mergeList.map(item => loadImage(item.dataUrl)));
      const targetWidth = Math.min(1080, Math.max(...images.map(img => img.naturalWidth)));
      const scaledHeights = images.map(img => Math.round(img.naturalHeight * (targetWidth / img.naturalWidth)));
      const totalHeight = scaledHeights.reduce((a, b) => a + b, 0) + MERGE_GAP * (images.length + 1);
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = MERGE_GAP;
      images.forEach((img, i) => {
        ctx.drawImage(img, 0, y, targetWidth, scaledHeights[i]);
        y += scaledHeights[i] + MERGE_GAP;
      });
      commitCanvas(canvas.toDataURL('image/png'));
      setActiveTab('removeText');
    } catch (err) {
      console.error('Merge failed:', err);
      alert('이미지 합치기 중 오류가 발생했습니다.');
    } finally {
      setIsMerging(false);
    }
  };

  // --- Remove text (AI) tab ---
  const handleRemoveText = async () => {
    if (!canvasDataUrl) return;
    setRemoveTextStatus('loading');
    setRemoveTextError('');
    try {
      const result = await editImageWithGemini(canvasDataUrl, REMOVE_TEXT_PROMPT);
      setRemoveTextResult(result);
      setRemoveTextStatus('success');
    } catch (err) {
      console.error('Remove text failed:', err);
      setRemoveTextError('AI 텍스트 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setRemoveTextStatus('error');
    }
  };

  const handleRemoveTextSelection = async () => {
    if (!canvasDataUrl || !selectionRect) return;
    setRemoveTextStatus('loading');
    setRemoveTextError('');
    try {
      const baseImg = await loadImage(canvasDataUrl);
      const w = naturalSize.width || baseImg.naturalWidth;
      const h = naturalSize.height || baseImg.naturalHeight;
      const composite = document.createElement('canvas');
      composite.width = w;
      composite.height = h;
      const ctx = composite.getContext('2d')!;
      ctx.drawImage(baseImg, 0, 0, w, h);
      ctx.fillStyle = 'rgba(255, 0, 230, 0.65)';
      ctx.fillRect((selectionRect.xPct / 100) * w, (selectionRect.yPct / 100) * h, (selectionRect.wPct / 100) * w, (selectionRect.hPct / 100) * h);
      const markedDataUrl = composite.toDataURL('image/png');
      const result = await editImageWithGemini(markedDataUrl, REMOVE_TEXT_SELECTION_PROMPT);
      setRemoveTextResult(result);
      setRemoveTextStatus('success');
    } catch (err) {
      console.error('Selective remove text failed:', err);
      setRemoveTextError('AI 텍스트 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setRemoveTextStatus('error');
    }
  };

  const acceptRemoveText = () => {
    if (!removeTextResult) return;
    commitCanvas(removeTextResult);
    setRemoveTextResult(null);
    setRemoveTextStatus('idle');
    setSelectionRect(null);
  };

  const discardRemoveText = () => {
    setRemoveTextResult(null);
    setRemoveTextStatus('idle');
    setRemoveTextError('');
  };

  const clearSelection = () => setSelectionRect(null);

  const getWrapperPct = (clientX: number, clientY: number) => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      xPct: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      yPct: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const handleSelectionPointerDown = (e: React.PointerEvent) => {
    if (!wrapperRef.current) return;
    const point = getWrapperPct(e.clientX, e.clientY);
    selectionStartRef.current = point;
    isSelectingRef.current = true;
    setSelectionRect({ xPct: point.xPct, yPct: point.yPct, wPct: 0, hPct: 0 });
  };

  const handleSelectionPointerMove = (e: React.PointerEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current || !wrapperRef.current) return;
    const point = getWrapperPct(e.clientX, e.clientY);
    const start = selectionStartRef.current;
    setSelectionRect({
      xPct: Math.min(start.xPct, point.xPct),
      yPct: Math.min(start.yPct, point.yPct),
      wPct: Math.abs(point.xPct - start.xPct),
      hPct: Math.abs(point.yPct - start.yPct),
    });
  };

  const handleSelectionPointerUp = () => {
    isSelectingRef.current = false;
  };

  // --- Add text tab ---
  const selectedLayer = useMemo(() => textLayers.find(l => l.id === selectedLayerId) || null, [textLayers, selectedLayerId]);

  const addTextLayer = (xPct = 50, yPct = 50) => {
    const id = generateId();
    setTextLayers(prev => [
      ...prev,
      {
        id,
        text: '',
        xPct,
        yPct,
        fontSize: Math.max(24, Math.round((naturalSize.width || 800) * 0.06)),
        color: '#ffffff',
        bold: false,
        italic: false,
        fontFamily: 'Pretendard',
        align: 'center',
      },
    ]);
    setSelectedLayerId(id);
    setEditingLayerId(id);
  };

  const updateLayer = (id: string, patch: Partial<TextLayer>) => {
    setTextLayers(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLayer = (id: string) => {
    setTextLayers(prev => prev.filter(l => l.id !== id));
    setEditingLayerId(prev => (prev === id ? null : prev));
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTab !== 'addText') {
      setSelectedLayerId(null);
      return;
    }
    if (editingLayerId || selectedLayerId) {
      setSelectedLayerId(null);
      return;
    }
    if (!wrapperRef.current) return;
    const { xPct, yPct } = getWrapperPct(e.clientX, e.clientY);
    addTextLayer(xPct, yPct);
  };

  const handleLayerClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if (editingLayerId === id) return;
    if (selectedLayerId === id) {
      setEditingLayerId(id);
    } else {
      setSelectedLayerId(id);
    }
  };

  const handleLayerPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (editingLayerId === id) return;
    setSelectedLayerId(id);
    draggingLayerIdRef.current = id;
    dragMovedRef.current = false;
  };

  const handleLayerBlur = (e: React.FocusEvent<HTMLDivElement>, id: string) => {
    const finalText = e.currentTarget.textContent || '';
    setEditingLayerId(prev => (prev === id ? null : prev));
    setTextLayers(prev => {
      if (finalText.trim() === '') return prev.filter(l => l.id !== id);
      return prev.map(l => (l.id === id ? { ...l, text: finalText } : l));
    });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingLayerIdRef.current || !wrapperRef.current) return;
      dragMovedRef.current = true;
      const { xPct, yPct } = getWrapperPct(e.clientX, e.clientY);
      updateLayer(draggingLayerIdRef.current, { xPct, yPct });
    };
    const handleUp = () => {
      draggingLayerIdRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  const buildCtxFont = (layer: TextLayer) =>
    `${layer.italic ? 'italic ' : ''}${layer.bold ? 'bold ' : ''}${layer.fontSize}px "${layer.fontFamily}"`;

  const handleApplyText = async () => {
    if (!canvasDataUrl || textLayers.length === 0) return;
    try {
      await Promise.all(textLayers.map(l => document.fonts.load(buildCtxFont(l)).catch(() => undefined)));
    } catch {
      // best-effort font preload; drawing still proceeds with fallback font if this fails
    }
    const baseImg = await loadImage(canvasDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = naturalSize.width || baseImg.naturalWidth;
    canvas.height = naturalSize.height || baseImg.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    textLayers.forEach(layer => {
      if (!layer.text.trim()) return;
      ctx.font = buildCtxFont(layer);
      ctx.fillStyle = layer.color;
      ctx.textAlign = layer.align;
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, (layer.xPct / 100) * canvas.width, (layer.yPct / 100) * canvas.height);
    });
    commitCanvas(canvas.toDataURL('image/png'));
    setTextLayers([]);
    setSelectedLayerId(null);
    setEditingLayerId(null);
  };

  // --- Brush eraser tab ---
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = brushCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const drawBrushSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = brushCanvasRef.current?.getContext('2d');
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
  };

  const handleBrushPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isPaintingRef.current = true;
    const point = getCanvasPoint(e);
    lastPaintPointRef.current = point;
    setBrushCursorPos(point);
    drawBrushSegment(point, point);
  };

  const handleBrushPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    setBrushCursorPos(point);
    if (!isPaintingRef.current || !lastPaintPointRef.current) return;
    drawBrushSegment(lastPaintPointRef.current, point);
    lastPaintPointRef.current = point;
  };

  const handleBrushPointerUp = () => {
    isPaintingRef.current = false;
    lastPaintPointRef.current = null;
  };

  const handleBrushPointerLeave = () => {
    handleBrushPointerUp();
    setBrushCursorPos(null);
  };

  const clearBrushMask = () => {
    const canvas = brushCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleBrushAiErase = async () => {
    if (!canvasDataUrl || !brushCanvasRef.current) return;
    setBrushAiStatus('loading');
    setBrushAiError('');
    try {
      const baseImg = await loadImage(canvasDataUrl);
      const composite = document.createElement('canvas');
      composite.width = naturalSize.width || baseImg.naturalWidth;
      composite.height = naturalSize.height || baseImg.naturalHeight;
      const ctx = composite.getContext('2d')!;
      ctx.drawImage(baseImg, 0, 0, composite.width, composite.height);
      ctx.drawImage(brushCanvasRef.current, 0, 0);
      const markedDataUrl = composite.toDataURL('image/png');
      const result = await editImageWithGemini(markedDataUrl, BRUSH_ERASE_PROMPT);
      setBrushAiResult(result);
      setBrushAiStatus('success');
    } catch (err) {
      console.error('Brush erase failed:', err);
      setBrushAiError('AI 지우기 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setBrushAiStatus('error');
    }
  };

  const acceptBrushErase = () => {
    if (!brushAiResult) return;
    commitCanvas(brushAiResult);
    setBrushAiResult(null);
    setBrushAiStatus('idle');
    clearBrushMask();
  };

  const discardBrushErase = () => {
    setBrushAiResult(null);
    setBrushAiStatus('idle');
    setBrushAiError('');
  };

  if (!isOpen) return null;

  const tabButtonClass = (tab: Tab) =>
    `flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
      activeTab === tab
        ? 'text-purple-300 border-purple-400 bg-slate-800'
        : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
    }`;

  const hasSelection = !!selectionRect && selectionRect.wPct > 1 && selectionRect.hPct > 1;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[70] p-4" onClick={onClose}>
      <div
        className="bg-slate-900 rounded-2xl shadow-2xl max-w-6xl w-full flex flex-col max-h-[95vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <SparklesIcon className="text-purple-400 w-5 h-5" />
            이미지 에디터{product ? ` · ${product.productName || '상품'}` : ''}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        <div className="flex gap-1 px-6 mt-4 border-b border-slate-700 overflow-x-auto">
          <button className={tabButtonClass('merge')} onClick={() => setActiveTab('merge')}>
            <LayersIcon className="h-4 w-4" /> 합치기
          </button>
          <button className={tabButtonClass('removeText')} onClick={() => setActiveTab('removeText')} disabled={!canvasDataUrl}>
            <SparklesIcon className="h-4 w-4" /> 텍스트 지우기(AI)
          </button>
          <button className={tabButtonClass('addText')} onClick={() => setActiveTab('addText')} disabled={!canvasDataUrl}>
            <TextToolIcon className="h-4 w-4" /> 텍스트 추가
          </button>
          <button className={tabButtonClass('brush')} onClick={() => setActiveTab('brush')} disabled={!canvasDataUrl}>
            <BrushIcon className="h-4 w-4" /> 브러쉬 지우개(AI)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col lg:flex-row gap-5 min-h-0">
          {/* Main preview area */}
          <div
            className="flex-1 min-w-0 bg-slate-950/60 rounded-xl border border-slate-700 grid place-items-center p-4 min-h-[320px] max-h-[65vh] relative overflow-auto"
            onWheel={handleWheelZoom}
          >
            {canvasDataUrl && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-0.5 bg-slate-900/90 border border-slate-700 rounded-lg px-1 py-1 backdrop-blur-sm">
                <button onClick={zoomOut} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 rounded-md text-base" title="축소">
                  −
                </button>
                <button onClick={resetZoom} className="px-2 h-7 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md w-14" title="원래 크기">
                  {Math.round(zoom * 100)}%
                </button>
                <button onClick={zoomIn} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 rounded-md text-base" title="확대">
                  ＋
                </button>
              </div>
            )}

            {!canvasDataUrl && activeTab === 'merge' ? (
              <p className="text-slate-500 text-sm">편집을 시작할 이미지를 선택하거나, 합칠 이미지를 추가해주세요.</p>
            ) : canvasDataUrl ? (
              <div
                ref={wrapperRef}
                className="relative inline-block max-w-full max-h-[55vh]"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                onClick={handleStageClick}
              >
                <img
                  ref={imgRef}
                  src={
                    activeTab === 'removeText' && removeTextResult
                      ? removeTextResult
                      : activeTab === 'brush' && brushAiResult
                      ? brushAiResult
                      : canvasDataUrl
                  }
                  onLoad={handleImgLoad}
                  alt="편집 대상 이미지"
                  className="block max-w-full max-h-[55vh] object-contain rounded-lg select-none"
                  draggable={false}
                />

                {activeTab === 'removeText' && !removeTextResult && (
                  <div
                    className="absolute inset-0 cursor-crosshair"
                    onPointerDown={handleSelectionPointerDown}
                    onPointerMove={handleSelectionPointerMove}
                    onPointerUp={handleSelectionPointerUp}
                    onPointerLeave={handleSelectionPointerUp}
                  >
                    {selectionRect && (
                      <div
                        className="absolute border-2 border-dashed border-pink-400 bg-pink-500/20"
                        style={{
                          left: `${selectionRect.xPct}%`,
                          top: `${selectionRect.yPct}%`,
                          width: `${selectionRect.wPct}%`,
                          height: `${selectionRect.hPct}%`,
                        }}
                      />
                    )}
                  </div>
                )}

                {activeTab === 'addText' &&
                  textLayers.map(layer => (
                    <div
                      key={`${layer.id}-${editingLayerId === layer.id ? 'edit' : 'view'}`}
                      ref={el => {
                        if (el) layerElRefs.current.set(layer.id, el);
                        else layerElRefs.current.delete(layer.id);
                      }}
                      contentEditable={editingLayerId === layer.id}
                      suppressContentEditableWarning
                      onBlur={e => handleLayerBlur(e, layer.id)}
                      onKeyDown={e => {
                        if (e.key === 'Escape' || e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLDivElement).blur();
                        }
                      }}
                      onPointerDown={e => handleLayerPointerDown(e, layer.id)}
                      onClick={e => handleLayerClick(e, layer.id)}
                      className={`absolute select-none whitespace-pre-wrap px-1 min-w-[2ch] min-h-[1em] ${
                        editingLayerId === layer.id ? 'cursor-text outline outline-2 outline-blue-400' : 'cursor-move'
                      } ${selectedLayerId === layer.id && editingLayerId !== layer.id ? 'outline outline-2 outline-dashed outline-blue-400' : ''}`}
                      style={{
                        left: `${layer.xPct}%`,
                        top: `${layer.yPct}%`,
                        transform: 'translate(-50%, -50%)',
                        fontSize: `${Math.max(8, layer.fontSize * previewScale)}px`,
                        color: layer.color,
                        fontWeight: layer.bold ? 700 : 400,
                        fontStyle: layer.italic ? 'italic' : 'normal',
                        fontFamily: layer.fontFamily,
                        textAlign: layer.align,
                      }}
                    >
                      {selectedLayerId === layer.id && editingLayerId !== layer.id && (
                        <button
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => {
                            e.stopPropagation();
                            removeLayer(layer.id);
                          }}
                          className="absolute -top-3 -right-3 w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded-full text-xs leading-none shadow hover:bg-red-400"
                          title="삭제"
                          style={{ fontFamily: 'sans-serif', fontStyle: 'normal', fontWeight: 700 }}
                        >
                          ×
                        </button>
                      )}
                      {layer.text}
                    </div>
                  ))}

                {activeTab === 'brush' && !brushAiResult && (
                  <canvas
                    ref={brushCanvasRef}
                    className="absolute inset-0 w-full h-full cursor-none"
                    onPointerDown={handleBrushPointerDown}
                    onPointerMove={handleBrushPointerMove}
                    onPointerUp={handleBrushPointerUp}
                    onPointerLeave={handleBrushPointerLeave}
                  />
                )}

                {activeTab === 'brush' && !brushAiResult && brushCursorPos && (
                  <div
                    className="absolute rounded-full border-2 border-pink-400 bg-pink-400/20 pointer-events-none"
                    style={{
                      left: `${brushCursorPos.x * previewScale}px`,
                      top: `${brushCursorPos.y * previewScale}px`,
                      width: `${brushSize * previewScale}px`,
                      height: `${brushSize * previewScale}px`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                )}

                {(removeTextStatus === 'loading' || brushAiStatus === 'loading') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/85 rounded-lg z-10">
                    <SpinnerIcon className="w-9 h-9 text-purple-400 animate-spin" />
                    <p className="text-slate-200 text-sm font-semibold">AI가 이미지를 편집하고 있습니다...</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">이미지가 없습니다.</p>
            )}
          </div>

          {/* Side tool panel */}
          <div className="lg:w-80 flex-shrink-0 flex flex-col gap-4">
            {activeTab === 'merge' && (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">바로 편집 시작</p>
                  <div className="flex gap-2">
                    {product?.thumbnailDataUrl && (
                      <button
                        onClick={() => {
                          setCanvasDataUrl(product.thumbnailDataUrl!);
                          setHistory([]);
                        }}
                        className="flex-1 text-xs px-2 py-2 bg-slate-800 border border-slate-600 rounded-md text-slate-200 hover:bg-slate-700 transition-colors"
                      >
                        대표 이미지
                      </button>
                    )}
                    {product?.detailDataUrl && (
                      <button
                        onClick={() => {
                          setCanvasDataUrl(product.detailDataUrl!);
                          setHistory([]);
                        }}
                        className="flex-1 text-xs px-2 py-2 bg-slate-800 border border-slate-600 rounded-md text-slate-200 hover:bg-slate-700 transition-colors"
                      >
                        상세 이미지
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">합칠 이미지 목록</p>
                  <div className="flex flex-wrap gap-2">
                    {product?.thumbnailDataUrl && (
                      <button
                        onClick={() => addExistingToMergeList(product.thumbnailDataUrl)}
                        className="text-xs px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-slate-300 hover:bg-slate-700"
                      >
                        + 대표 이미지
                      </button>
                    )}
                    {product?.detailDataUrl && (
                      <button
                        onClick={() => addExistingToMergeList(product.detailDataUrl)}
                        className="text-xs px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-slate-300 hover:bg-slate-700"
                      >
                        + 상세 이미지
                      </button>
                    )}
                    <label className="text-xs px-2 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-500 cursor-pointer flex items-center gap-1">
                      <UploadIcon className="h-3.5 w-3.5" /> 파일 업로드
                      <input type="file" accept="image/*" multiple className="sr-only" onChange={handleMergeFilesSelect} />
                    </label>
                  </div>

                  {mergeList.length > 0 && (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {mergeList.map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-md p-1.5">
                          <img src={item.dataUrl} className="w-9 h-9 object-cover rounded flex-shrink-0" alt="" />
                          <span className="text-xs text-slate-400 flex-1">{idx + 1}번</span>
                          <button onClick={() => moveMergeItem(item.id, -1)} className="p-1 text-slate-400 hover:text-slate-200">
                            <ChevronUpIcon />
                          </button>
                          <button onClick={() => moveMergeItem(item.id, 1)} className="p-1 text-slate-400 hover:text-slate-200">
                            <ChevronDownIcon />
                          </button>
                          <button onClick={() => removeMergeItem(item.id)} className="p-1 text-slate-400 hover:text-red-400">
                            <TrashIcon />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-slate-500">이미지 사이에 {MERGE_GAP}px 흰색 여백을 자동으로 넣어 합쳐요.</p>

                  <button
                    onClick={handleMerge}
                    disabled={mergeList.length === 0 || isMerging}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isMerging ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <LayersIcon className="h-4 w-4" />}
                    {mergeList.length}개 이미지 합치기
                  </button>
                </div>
              </>
            )}

            {activeTab === 'removeText' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  이미지 위를 드래그해서 영역을 선택하면 선택한 부분의 텍스트만 지울 수 있어요. 선택하지 않으면 이미지 전체에서 텍스트를 찾아 지웁니다.
                </p>
                {removeTextStatus !== 'success' ? (
                  <>
                    {hasSelection && (
                      <div className="space-y-2 pb-2 border-b border-slate-700">
                        <button
                          onClick={handleRemoveTextSelection}
                          disabled={removeTextStatus === 'loading'}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-500 transition-colors disabled:opacity-40"
                        >
                          {removeTextStatus === 'loading' ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                          선택 영역만 텍스트 삭제
                        </button>
                        <button onClick={clearSelection} className="w-full px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors">
                          선택 영역 초기화
                        </button>
                      </div>
                    )}
                    <button
                      onClick={handleRemoveText}
                      disabled={removeTextStatus === 'loading'}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-40"
                    >
                      {removeTextStatus === 'loading' ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                      전체 이미지에서 텍스트 삭제
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <button onClick={acceptRemoveText} className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors">
                      결과 적용하기
                    </button>
                    <button onClick={discardRemoveText} className="w-full px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors text-sm">
                      취소하고 다시 시도
                    </button>
                  </div>
                )}
                {removeTextStatus === 'error' && <p className="text-red-400 text-xs">{removeTextError}</p>}
              </div>
            )}

            {activeTab === 'addText' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  이미지를 클릭하면 그 자리에 텍스트를 입력할 수 있어요. 박스는 드래그로 이동, 클릭하면 다시 수정할 수 있어요.
                </p>
                <button
                  onClick={() => addTextLayer()}
                  disabled={!canvasDataUrl}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 text-slate-100 font-semibold rounded-lg hover:bg-slate-600 transition-colors"
                >
                  <TextToolIcon className="h-4 w-4" /> 가운데에 텍스트 추가
                </button>

                {selectedLayer && (
                  <div className="space-y-2.5 bg-slate-800 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-12">폰트</span>
                      <select
                        value={selectedLayer.fontFamily}
                        onChange={e => updateLayer(selectedLayer.id, { fontFamily: e.target.value as FontFamily })}
                        className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100"
                      >
                        <option value="Pretendard">Pretendard</option>
                        <option value="Paperlogy">Paperlogy</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-12">크기</span>
                      <input
                        type="range"
                        min={12}
                        max={Math.max(60, Math.round((naturalSize.width || 800) * 0.3))}
                        value={selectedLayer.fontSize}
                        onChange={e => updateLayer(selectedLayer.id, { fontSize: Number(e.target.value) })}
                        className="flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-12">색상</span>
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={e => updateLayer(selectedLayer.id, { color: e.target.value })}
                        className="w-9 h-7 bg-transparent border-0 cursor-pointer"
                      />
                      <button
                        onClick={() => updateLayer(selectedLayer.id, { bold: !selectedLayer.bold })}
                        className={`w-8 h-7 text-sm font-bold rounded-md border ${
                          selectedLayer.bold ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                        }`}
                      >
                        B
                      </button>
                      <button
                        onClick={() => updateLayer(selectedLayer.id, { italic: !selectedLayer.italic })}
                        className={`w-8 h-7 text-sm italic rounded-md border ${
                          selectedLayer.italic ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                        }`}
                      >
                        I
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(['left', 'center', 'right'] as CanvasTextAlign[]).map(align => (
                        <button
                          key={align}
                          onClick={() => updateLayer(selectedLayer.id, { align })}
                          className={`flex-1 px-2 py-1 text-xs rounded-md border ${
                            selectedLayer.align === align ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'
                          }`}
                        >
                          {align === 'left' ? '왼쪽' : align === 'center' ? '가운데' : '오른쪽'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => removeLayer(selectedLayer.id)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                    >
                      <TrashIcon /> 이 텍스트 삭제
                    </button>
                  </div>
                )}

                <button
                  onClick={handleApplyText}
                  disabled={textLayers.length === 0}
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  이미지에 합성하기
                </button>
              </div>
            )}

            {activeTab === 'brush' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  지우고 싶은 부분을 브러쉬로 칠한 뒤 AI로 자연스럽게 지워보세요.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-14">브러쉬 크기</span>
                  <input type="range" min={10} max={150} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="flex-1" />
                </div>

                {brushAiStatus !== 'success' ? (
                  <>
                    <button
                      onClick={clearBrushMask}
                      className="w-full px-3 py-2 text-sm bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors"
                    >
                      마스크 초기화
                    </button>
                    <button
                      onClick={handleBrushAiErase}
                      disabled={brushAiStatus === 'loading'}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-40"
                    >
                      {brushAiStatus === 'loading' ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <BrushIcon className="h-4 w-4" />}
                      AI로 자연스럽게 지우기
                    </button>
                    {brushAiStatus === 'error' && <p className="text-red-400 text-xs">{brushAiError}</p>}
                  </>
                ) : (
                  <div className="space-y-2">
                    <button onClick={acceptBrushErase} className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors">
                      결과 적용하기
                    </button>
                    <button onClick={discardBrushErase} className="w-full px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors text-sm">
                      취소하고 다시 시도
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-700">
          <div className="flex items-center gap-2">
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <UndoIcon className="h-4 w-4" /> 실행 취소
            </button>
            <button
              onClick={handleDownload}
              disabled={!canvasDataUrl}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <DownloadIcon /> 다운로드
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-600 transition-colors">
              닫기
            </button>
            <button
              onClick={() => handleSaveAs('thumbnailDataUrl')}
              disabled={!canvasDataUrl}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SaveIcon /> 대표 이미지로 저장
            </button>
            <button
              onClick={() => handleSaveAs('detailDataUrl')}
              disabled={!canvasDataUrl}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SaveIcon /> 상세 이미지로 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageEditorModal;
