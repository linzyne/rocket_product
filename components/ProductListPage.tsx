
import React, { useMemo, useState } from 'react';
import { ArchivedProduct } from '../types';
import BarcodeImage from './BarcodeImage';
import BarcodeLabel, { BarcodeLabelProduct } from './BarcodeLabel';
import { ChevronLeftIcon, SearchIcon, TrashIcon, ExternalLinkIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, BroomIcon, PlusIcon } from './Icons';
import { isFirebaseConfigured } from '../utils/firebase';
import { generateBarcodeNumber } from '../utils/barcode';
import { resizeImageDataUrl } from '../utils/imageResize';

const toBarcodeLabelProduct = (entry: ArchivedProduct): BarcodeLabelProduct => ({
  productName: entry.productName,
  color: entry.color,
  sizeWidth: entry.sizeWidth,
  sizeHeight: entry.sizeHeight,
  sizeDepth: entry.sizeDepth,
  material: entry.material,
  customFields: {},
  countryOfOrigin: entry.countryOfOrigin,
  recommendedAge: entry.recommendedAge,
  cautionNote: entry.cautionNote,
  importer: entry.importer,
  manufacturer: entry.manufacturer,
  barcode: entry.barcode,
});

interface ProductListPageProps {
  entries: ArchivedProduct[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onUpdate: (id: string, updates: Partial<ArchivedProduct>) => void;
  onAddManual: (entry: Omit<ArchivedProduct, 'id' | 'savedAt'>) => void;
  dateRange: { start: string; end: string };
  onDateRangeChange: (range: { start: string; end: string }) => void;
  lookbackDays: number;
  onLookbackDaysChange: (days: number) => void;
}

const toLocalDateOnly = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const presetDateRange = (days: number): { start: string; end: string } => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: toLocalDateOnly(start), end: toLocalDateOnly(end) };
};

const FAR_PAST_DATE = '2000-01-01';

const formatWon = (value: string | number) => `₩ ${(Number(value) || 0).toLocaleString()}`;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ProductListPage: React.FC<ProductListPageProps> = ({
  entries,
  onBack,
  onDelete,
  onClearAll,
  onUpdate,
  onAddManual,
  dateRange,
  onDateRangeChange,
  lookbackDays,
  onLookbackDaysChange,
}) => {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enlargedEntry, setEnlargedEntry] = useState<ArchivedProduct | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [approvedOnly, setApprovedOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...entries].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    if (approvedOnly) list = list.filter(e => e.approvalStatus === 'approved');
    if (q) list = list.filter(e => e.productName.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
    return list;
  }, [entries, query, approvedOnly]);

  const approvedCount = useMemo(() => entries.filter(e => e.approvalStatus === 'approved').length, [entries]);

  const handleClearAll = () => {
    if (entries.length === 0) return;
    const scopeNote = isFirebaseConfigured ? ' (지금 조회 중인 기간 기준입니다. 기간 밖의 데이터는 남습니다)' : '';
    if (window.confirm(`저장된 상품 ${entries.length}건을 모두 삭제하시겠습니까?${scopeNote} 되돌릴 수 없습니다.`)) {
      onClearAll();
    }
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setExpandedId(prev => (prev === id ? null : prev));
  };

  return (
    <div className="w-full max-w-screen-2xl text-gray-900">
      <header className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors flex-shrink-0"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            <span>상품 등록으로</span>
          </button>
          <div className="relative flex-1 sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="상품명 또는 URL로 검색..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-1.5 bg-white border border-gray-300 text-gray-900 text-sm placeholder:text-gray-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
          </div>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 cursor-pointer whitespace-nowrap flex-shrink-0 select-none">
            <input
              type="checkbox"
              checked={approvedOnly}
              onChange={e => setApprovedOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            승인된 것만 ({approvedCount})
          </label>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
              isFirebaseConfigured ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
            title={isFirebaseConfigured ? '다른 컴퓨터와 실시간으로 같은 목록을 봅니다' : '이 컴퓨터에만 저장됩니다 (클라우드 미설정)'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isFirebaseConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {isFirebaseConfigured ? '클라우드 동기화 중' : '이 컴퓨터에만 저장'}
          </span>
          <span className="text-sm text-gray-500 whitespace-nowrap">{entries.length}건 저장됨</span>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 border border-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          >
            <PlusIcon />
            <span className="hidden sm:inline">직접 추가</span>
          </button>
          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-red-600 text-sm font-medium rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
            >
              <BroomIcon />
              <span className="hidden sm:inline">전체 삭제</span>
            </button>
          )}
        </div>
      </header>

      {isFirebaseConfigured && (
        <div
          className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-gray-200 rounded-md px-3 py-2"
          title="선택한 기간만 클라우드에서 불러와 비용과 로딩 속도를 아낍니다"
        >
          <span className="text-xs text-gray-500 flex-shrink-0">조회 기간</span>
          <input
            type="date"
            value={dateRange.start}
            max={dateRange.end}
            onChange={e => onDateRangeChange({ ...dateRange, start: e.target.value })}
            className="px-2 py-1 bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">~</span>
          <input
            type="date"
            value={dateRange.end}
            min={dateRange.start}
            onChange={e => onDateRangeChange({ ...dateRange, end: e.target.value })}
            className="px-2 py-1 bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-1">
            {[3, 7, 30].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => onDateRangeChange(presetDateRange(d))}
                className="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
              >
                최근 {d}일
              </button>
            ))}
            <button
              type="button"
              onClick={() => onDateRangeChange({ start: FAR_PAST_DATE, end: toLocalDateOnly(new Date()) })}
              className="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
            >
              전체
            </button>
          </div>
          <span className="flex-1" />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
            앱 실행 시 기본으로
            <input
              type="number"
              min={1}
              value={lookbackDays}
              onChange={e => onLookbackDaysChange(Number(e.target.value))}
              className="w-14 px-1.5 py-1 bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            일치 불러오기
          </label>
        </div>
      )}

      <p className="text-sm text-gray-500 mb-4">
        상품 행의 별 버튼을 누르거나 상품을 삭제/초기화하면 URL·상품명·공급가·판매가·바코드·대표이미지 썸네일이 여기 남습니다. 원본 이미지·엑셀 파일은 저장되지 않습니다.
      </p>

      {entries.length === 0 ? (
        <div className="text-center py-20 bg-white border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400">
            {isFirebaseConfigured ? '이 조회 기간에 저장된 상품이 없습니다. 기간을 넓혀보세요.' : '아직 저장된 상품이 없습니다.'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400">{approvedOnly ? '승인된 상품이 없습니다.' : '검색 결과가 없습니다.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(entry => (
            <ProductListRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => setExpandedId(prev => (prev === entry.id ? null : entry.id))}
              onDelete={() => handleDelete(entry.id)}
              onEnlargeBarcode={setEnlargedEntry}
              onUpdate={updates => onUpdate(entry.id, updates)}
            />
          ))}
        </div>
      )}

      {enlargedEntry && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[1000] p-4 transition-opacity duration-300"
          onClick={() => setEnlargedEntry(null)}
        >
          <div
            className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setEnlargedEntry(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <h2 className="text-xl font-bold text-slate-100 mb-6">바코드 라벨</h2>
            <div className="bg-white rounded-lg p-4 flex justify-center overflow-x-auto">
              <div style={{ zoom: 0.32 }}>
                <BarcodeLabel product={toBarcodeLabelProduct(enlargedEntry)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <AddManualEntryModal
          onCancel={() => setShowAddForm(false)}
          onSave={entry => {
            onAddManual(entry);
            setShowAddForm(false);
          }}
        />
      )}
    </div>
  );
};

interface AddManualEntryModalProps {
  onCancel: () => void;
  onSave: (entry: Omit<ArchivedProduct, 'id' | 'savedAt'>) => void;
}

const emptyManualEntry = () => ({
  url: '',
  productName: '',
  costPrice: '0',
  supplyPrice: '0',
  sellingPrice: '0',
  margin: '0',
  barcode: generateBarcodeNumber(),
  color: '',
  sizeWidth: '',
  sizeHeight: '',
  sizeDepth: '',
  material: '',
  countryOfOrigin: '',
  recommendedAge: '',
  cautionNote: '',
  importer: '',
  manufacturer: '',
  thumbnailDataUrl: '',
  approvalStatus: 'pending' as const,
});

const AddManualEntryModal: React.FC<AddManualEntryModalProps> = ({ onCancel, onSave }) => {
  const [form, setForm] = useState(emptyManualEntry);
  const [thumbLoading, setThumbLoading] = useState(false);

  const setField = (field: keyof ReturnType<typeof emptyManualEntry>) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleThumbnailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setThumbLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const resized = await resizeImageDataUrl(dataUrl);
      setForm(prev => ({ ...prev, thumbnailDataUrl: resized }));
    } catch {
      alert('이미지를 불러오지 못했습니다.');
    } finally {
      setThumbLoading(false);
    }
  };

  const handleSave = () => {
    if (!form.url.trim() && !form.productName.trim()) {
      alert('URL 또는 상품명이 있어야 저장할 수 있습니다.');
      return;
    }
    onSave(form);
  };

  const inputClass = 'w-full px-2.5 py-1.5 bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors';
  const labelClass = 'block text-xs text-gray-500 mb-1';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[1000] p-4 transition-opacity duration-300"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 relative max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <h2 className="text-lg font-bold text-gray-900 mb-4">상품 직접 추가</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>상품명</label>
            <input type="text" value={form.productName} onChange={setField('productName')} className={inputClass} autoFocus />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>URL</label>
            <input type="text" value={form.url} onChange={setField('url')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>공급가</label>
            <input type="number" value={form.supplyPrice} onChange={setField('supplyPrice')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>판매가</label>
            <input type="number" value={form.sellingPrice} onChange={setField('sellingPrice')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>매입가</label>
            <input type="number" value={form.costPrice} onChange={setField('costPrice')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>마진</label>
            <input type="number" value={form.margin} onChange={setField('margin')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>바코드</label>
            <input type="text" value={form.barcode} onChange={setField('barcode')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>색상</label>
            <input type="text" value={form.color} onChange={setField('color')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>가로(mm)</label>
            <input type="text" value={form.sizeWidth} onChange={setField('sizeWidth')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>세로(mm)</label>
            <input type="text" value={form.sizeHeight} onChange={setField('sizeHeight')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>높이(mm)</label>
            <input type="text" value={form.sizeDepth} onChange={setField('sizeDepth')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>재질</label>
            <input type="text" value={form.material} onChange={setField('material')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>원산지</label>
            <input type="text" value={form.countryOfOrigin} onChange={setField('countryOfOrigin')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>사용연령</label>
            <input type="text" value={form.recommendedAge} onChange={setField('recommendedAge')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>제조자</label>
            <input type="text" value={form.manufacturer} onChange={setField('manufacturer')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>수입자</label>
            <input type="text" value={form.importer} onChange={setField('importer')} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>주의사항</label>
            <textarea value={form.cautionNote} onChange={setField('cautionNote')} className={`${inputClass} min-h-[60px]`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>대표 이미지 (선택)</label>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 flex-shrink-0 bg-gray-50 rounded-md overflow-hidden border border-gray-200">
                {form.thumbnailDataUrl && (
                  <img src={form.thumbnailDataUrl} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <input type="file" accept="image/*" onChange={handleThumbnailChange} className="text-sm text-gray-600" />
              {thumbLoading && <span className="text-xs text-gray-400">불러오는 중...</span>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 border border-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProductListRowProps {
  entry: ArchivedProduct;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEnlargeBarcode: (entry: ArchivedProduct) => void;
  onUpdate: (updates: Partial<ArchivedProduct>) => void;
}

type EditableAmountField = 'supplyPrice' | 'sellingPrice' | 'margin';

const ProductListRow: React.FC<ProductListRowProps> = ({ entry, isExpanded, onToggle, onDelete, onEnlargeBarcode, onUpdate }) => {
  const costPrice = Number(entry.costPrice) || 0;
  const supplyPrice = Number(entry.supplyPrice) || 0;
  const sellingPrice = Number(entry.sellingPrice) || 0;
  const supplyMargin = supplyPrice - costPrice;
  // 기존에 저장된 항목에는 margin 필드가 없을 수 있어, 그럴 때만 판매가-공급가로 계산해 보여준다.
  const margin = entry.margin !== undefined && entry.margin !== '' ? Number(entry.margin) || 0 : sellingPrice - supplyPrice;

  const [editingField, setEditingField] = useState<EditableAmountField | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [thumbLoading, setThumbLoading] = useState(false);

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setThumbLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const resized = await resizeImageDataUrl(dataUrl);
      onUpdate({ thumbnailDataUrl: resized });
    } catch {
      alert('이미지를 불러오지 못했습니다.');
    } finally {
      setThumbLoading(false);
    }
  };

  const amountValues: Record<EditableAmountField, number> = {
    supplyPrice,
    sellingPrice,
    margin,
  };

  const startEdit = (field: EditableAmountField) => {
    setEditingField(field);
    setDraftValue(String(amountValues[field]));
  };

  const commitEdit = () => {
    if (!editingField) return;
    const numeric = draftValue.trim();
    onUpdate({ [editingField]: numeric === '' ? '0' : numeric });
    setEditingField(null);
  };

  const renderAmount = (field: EditableAmountField, label: string, colorClass: string, extraClass = '') => (
    <span className={`${extraClass} inline-flex items-center`}>
      {editingField === field ? (
        <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <span className={`${colorClass} whitespace-nowrap`}>{label}</span>
          <input
            type="number"
            autoFocus
            value={draftValue}
            onChange={e => setDraftValue(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={commitEdit}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingField(null); }
            }}
            className="w-20 px-1 py-0.5 border border-blue-400 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </span>
      ) : (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); startEdit(field); }}
          className={`${colorClass} whitespace-nowrap hover:underline decoration-dotted underline-offset-2 focus:outline-none`}
          title="클릭해서 수정"
        >
          {label} {formatWon(amountValues[field])}
        </button>
      )}
    </span>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer text-left"
        aria-expanded={isExpanded}
      >
        <span className="flex-shrink-0 text-gray-400">
          {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </span>

        <label
          className="relative w-9 h-9 flex-shrink-0 bg-gray-50 rounded-md overflow-hidden border border-gray-200 cursor-pointer group"
          onClick={e => e.stopPropagation()}
          title="클릭해서 이미지 업로드"
        >
          <input type="file" accept="image/*" className="hidden" onChange={handleThumbnailUpload} />
          {entry.thumbnailDataUrl ? (
            <img src={entry.thumbnailDataUrl} alt={entry.productName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[9px] text-gray-300 px-1 text-center leading-tight">이미지<br />없음</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
            {thumbLoading ? (
              <span className="text-[8px] text-white">로딩중</span>
            ) : (
              <span className="text-[8px] text-white opacity-0 group-hover:opacity-100 transition-opacity">변경</span>
            )}
          </div>
        </label>

        <div className="w-14 h-9 flex-shrink-0 bg-gray-50 rounded-md flex items-center justify-center overflow-hidden border border-gray-200">
          {entry.barcode ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onEnlargeBarcode(entry); }}
              className="w-full h-full flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="바코드 라벨 크게 보기"
            >
              <BarcodeImage value={entry.barcode} height={22} className="max-h-full object-contain" />
            </button>
          ) : (
            <span className="text-[9px] text-gray-300 px-1 text-center leading-tight">바코드<br />없음</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{entry.productName || '상품명 없음'}</p>
          <p className="text-xs text-gray-400 truncate">{entry.color || '색상 없음'}</p>
        </div>

        <div className="flex-shrink-0 flex items-center gap-3 text-xs font-mono">
          {renderAmount('supplyPrice', '공급', 'text-emerald-700')}
          {renderAmount('sellingPrice', '판매', 'text-blue-700', 'hidden sm:inline-flex')}
          {renderAmount('margin', '마진', 'text-amber-700', 'hidden sm:inline-flex')}
        </div>

        <label
          className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer select-none transition-colors ${
            entry.approvalStatus === 'approved'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-gray-50 text-gray-500 border border-gray-200'
          }`}
          onClick={e => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={entry.approvalStatus === 'approved'}
            onChange={e => onUpdate({ approvalStatus: e.target.checked ? 'approved' : 'pending' })}
            className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="hidden sm:inline">승인</span>
        </label>

        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="flex-shrink-0 text-gray-400 hover:text-red-500 transition-colors duration-200 p-1.5 rounded-md hover:bg-red-500/10"
          aria-label="삭제"
          title="삭제"
        >
          <TrashIcon />
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
          <div className="pt-3">
            <label
              className="relative w-24 h-24 inline-flex items-center justify-center bg-gray-50 rounded-md border border-gray-200 overflow-hidden cursor-pointer group"
              title="클릭해서 이미지 업로드"
            >
              <input type="file" accept="image/*" className="hidden" onChange={handleThumbnailUpload} />
              {entry.thumbnailDataUrl ? (
                <img
                  src={entry.thumbnailDataUrl}
                  alt={entry.productName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[10px] text-gray-300 px-1 text-center leading-tight">이미지<br />없음</span>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                {thumbLoading ? (
                  <span className="text-[10px] text-white">로딩중...</span>
                ) : (
                  <span className="text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">이미지 변경</span>
                )}
              </div>
            </label>
          </div>

          <div className="flex items-center gap-2 pt-3">
            <span className="text-xs text-gray-400 flex-shrink-0 w-16">URL</span>
            {entry.url ? (
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 truncate inline-flex items-center gap-1"
              >
                <span className="truncate">{entry.url}</span>
                <ExternalLinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
              </a>
            ) : (
              <span className="text-sm text-gray-400">없음</span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2">
              <p className="text-[10px] text-gray-400">공급가</p>
              <p className="text-sm font-semibold text-gray-900">{formatWon(supplyPrice)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2">
              <p className="text-[10px] text-gray-400">공급가마진</p>
              <p className="text-sm font-semibold text-emerald-600">{formatWon(supplyMargin)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2">
              <p className="text-[10px] text-gray-400">판매가</p>
              <p className="text-sm font-semibold text-gray-900">{formatWon(sellingPrice)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2">
              <p className="text-[10px] text-gray-400">마진</p>
              <p className="text-sm font-semibold text-amber-600">{formatWon(margin)}</p>
            </div>
          </div>

          {entry.barcode && (
            <div>
              <p className="text-[10px] text-gray-400 mb-1">바코드 (클릭하면 라벨 크게 보기)</p>
              <button
                type="button"
                onClick={() => onEnlargeBarcode(entry)}
                className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2 inline-flex hover:bg-gray-100 transition-colors"
              >
                <BarcodeImage value={entry.barcode} height={40} />
              </button>
            </div>
          )}

          <p className="text-[11px] text-gray-400">저장일시: {formatDate(entry.savedAt)}</p>
        </div>
      )}
    </div>
  );
};

export default ProductListPage;
