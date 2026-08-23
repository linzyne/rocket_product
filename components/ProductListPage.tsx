
import React, { useMemo, useState } from 'react';
import { ArchivedProduct } from '../types';
import BarcodeImage from './BarcodeImage';
import BarcodeLabel, { BarcodeLabelProduct } from './BarcodeLabel';
import { ChevronLeftIcon, SearchIcon, TrashIcon, ExternalLinkIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, BroomIcon } from './Icons';
import { isFirebaseConfigured } from '../utils/firebase';

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
}

const formatWon = (value: string | number) => `₩ ${(Number(value) || 0).toLocaleString()}`;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ProductListPage: React.FC<ProductListPageProps> = ({ entries, onBack, onDelete, onClearAll, onUpdate }) => {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enlargedEntry, setEnlargedEntry] = useState<ArchivedProduct | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...entries].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    if (!q) return sorted;
    return sorted.filter(e => e.productName.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  }, [entries, query]);

  const handleClearAll = () => {
    if (entries.length === 0) return;
    if (window.confirm(`저장된 상품 ${entries.length}건을 모두 삭제하시겠습니까? 되돌릴 수 없습니다.`)) {
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

      <p className="text-sm text-gray-500 mb-4">
        상품 행의 별 버튼을 누르거나 상품을 삭제/초기화하면 URL·상품명·공급가·판매가·바코드·대표이미지 썸네일이 여기 남습니다. 원본 이미지·엑셀 파일은 저장되지 않습니다.
      </p>

      {entries.length === 0 ? (
        <div className="text-center py-20 bg-white border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400">아직 저장된 상품이 없습니다.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400">검색 결과가 없습니다.</p>
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

        <div className="w-9 h-9 flex-shrink-0 bg-gray-50 rounded-md overflow-hidden border border-gray-200">
          {entry.thumbnailDataUrl ? (
            <img src={entry.thumbnailDataUrl} alt={entry.productName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[9px] text-gray-300 px-1 text-center leading-tight">이미지<br />없음</span>
            </div>
          )}
        </div>

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
          {entry.thumbnailDataUrl && (
            <div className="pt-3">
              <img
                src={entry.thumbnailDataUrl}
                alt={entry.productName}
                className="w-24 h-24 object-cover rounded-md border border-gray-200"
              />
            </div>
          )}

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
