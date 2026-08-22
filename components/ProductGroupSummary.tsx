
import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../types';
import { ImageIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, ClipboardIcon, DocumentAddIcon, SaveIcon, StarIcon, CheckIcon, SpinnerIcon } from './Icons';
import { QuoteTemplateRegistration } from '../data/quoteTemplates';
import { CATEGORY_PRESETS } from '../data/categoryPresets';

interface ProductGroupSummaryProps {
  groupIndex: number;
  products: Product[];
  isExpanded: boolean;
  onToggle: () => void;
  onProductChange: (id: string, field: keyof Product, value: string) => void;
  registeredCategories: string[];
  quoteTemplateRegistrations: QuoteTemplateRegistration[];
  onImportFrom1688: (id: string) => void;
  isImportingFrom1688: boolean;
  onOpenDetailPageBuilder: (product: Product) => void;
  isDetailPageDone: boolean;
  onIntegratedDownload: (id: string) => void;
  isIntegratedDownloading: boolean;
  isIntegratedDownloadDone: boolean;
  onArchiveGroup: (products: Product[]) => boolean;
}

const inputClass = "w-full px-3 py-1 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200";

const ProductGroupSummary: React.FC<ProductGroupSummaryProps> = ({
  groupIndex,
  products,
  isExpanded,
  onToggle,
  onProductChange,
  registeredCategories,
  quoteTemplateRegistrations,
  onImportFrom1688,
  isImportingFrom1688,
  onOpenDetailPageBuilder,
  isDetailPageDone,
  onIntegratedDownload,
  isIntegratedDownloading,
  isIntegratedDownloadDone,
  onArchiveGroup,
}) => {
  const lead = products[0];
  const thumbnail = products.find(p => p.thumbnailDataUrl)?.thumbnailDataUrl;
  const optionCount = products.length;
  const colors = Array.from(new Set(products.map(p => p.color.trim()).filter(Boolean)));

  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [isArchiveDone, setIsArchiveDone] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target as Node)) {
        setShowCategoryMenu(false);
      }
    };
    if (showCategoryMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCategoryMenu]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onProductChange(lead.id, 'url', e.target.value);
  };

  const handleOpenUrl = () => {
    if (!lead.url) return;
    const href = /^https?:\/\//i.test(lead.url) ? lead.url : `https://${lead.url}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onProductChange(lead.id, 'category', e.target.value);
  };

  const handleSelectPreset = (fullPath: string) => {
    onProductChange(lead.id, 'category', fullPath);
    setShowCategoryMenu(false);
  };

  const handleQuoteTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onProductChange(lead.id, 'quoteTemplateId', e.target.value);
  };

  const handleArchiveClick = () => {
    const saved = onArchiveGroup(products);
    if (!saved) return;
    setIsArchiveDone(true);
    setTimeout(() => setIsArchiveDone(false), 1500);
  };

  return (
    <div className="w-full flex flex-col gap-2 px-4 py-2 bg-white rounded-xl border border-gray-200 shadow-lg hover:border-gray-300 transition-colors duration-150">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
          aria-expanded={isExpanded}
        >
          <span className="flex-shrink-0 w-6 text-center text-sm font-semibold text-gray-500">{groupIndex}</span>
          <span className="flex-shrink-0 text-gray-400">
            {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </span>

          <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-md flex items-center justify-center overflow-hidden border border-gray-200 text-gray-400">
            {thumbnail ? (
              <img src={thumbnail} alt={lead.productName} className="w-full h-full object-cover" />
            ) : (
              <ImageIcon />
            )}
          </div>

          <span className="text-sm font-semibold text-gray-900 truncate min-w-0">
            {lead.productName || '상품명 없음'}
          </span>
        </button>

        <span className="flex-shrink-0 px-2 py-1 rounded-md bg-gray-100 text-gray-900 text-xs font-semibold whitespace-nowrap">
          옵션 {optionCount}개
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {colors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mr-2">
            {colors.map(color => (
              <span
                key={color}
                className="px-1.5 py-0.5 text-[10px] leading-none rounded bg-gray-50 text-gray-700 border border-gray-200 whitespace-nowrap"
              >
                {color}
              </span>
            ))}
          </div>
        )}

        <div className="relative flex items-center justify-center flex-shrink-0 w-9 h-9 ml-auto" title="URL (클릭해서 붙여넣기 · 아이콘 클릭 시 새 탭에서 열기)">
          <input
            type="text"
            value={lead.url}
            onChange={handleUrlChange}
            onFocus={handleFocus}
            className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          />
          <button
            type="button"
            onClick={handleOpenUrl}
            disabled={!lead.url}
            className="pointer-events-none text-gray-400 p-1 rounded-full disabled:opacity-30"
          >
            <ExternalLinkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="relative flex-1 basis-[100px] min-w-[80px]" ref={categoryMenuRef}>
          <div className="relative flex items-center">
            <input
              type="text"
              value={lead.category}
              onChange={handleCategoryChange}
              onFocus={handleFocus}
              className={`${inputClass} pr-7 overflow-hidden text-ellipsis`}
              placeholder="카테고리"
            />
            <button
              type="button"
              onClick={() => setShowCategoryMenu(v => !v)}
              className="absolute right-1 text-gray-400 hover:text-blue-600 p-1 transition-colors"
              title="카테고리 프리셋"
            >
              <ChevronDownIcon />
            </button>
          </div>

          {showCategoryMenu && (
            <div className="absolute left-0 top-full mt-2 w-72 max-h-96 overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-2xl z-[9999] py-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {registeredCategories.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50 mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">등록된 카테고리</span>
                  </div>
                  {registeredCategories.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleSelectPreset(c)}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-600 hover:text-white transition-colors border-b border-gray-200 last:border-0"
                    >
                      <div className="font-semibold">{c}</div>
                    </button>
                  ))}
                </>
              )}
              <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50 mb-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">카테고리 빠른 선택</span>
              </div>
              {Object.entries(CATEGORY_PRESETS).map(([name, fullPath]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSelectPreset(fullPath)}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-600 hover:text-white transition-colors border-b border-gray-200 last:border-0 group"
                >
                  <div className="font-semibold">{name}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5 group-hover:text-blue-100 line-clamp-1">{fullPath}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 basis-[100px] min-w-[80px]">
          <select
            value={lead.quoteTemplateId}
            onChange={handleQuoteTemplateChange}
            className={`${inputClass} truncate`}
            title="이 상품 견적서 생성 시 사용할 등록된 견적서"
          >
            <option value="">견적서 선택 안함</option>
            {quoteTemplateRegistrations.map(r => (
              <option key={r.id} value={r.id}>{r.category} · {r.fileName}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onImportFrom1688(lead.id)}
          disabled={isImportingFrom1688}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-orange-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-orange-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="1688에서 붙여넣기"
          title="1688 캡처 확장프로그램으로 복사한 데이터를 붙여넣기 (옵션이 여러 개면 그 개수만큼 상품행 자동 생성 · URL/중량은 공통, 원가/사이즈/노출속성은 옵션별로 반영, 상품명/제조사/검색어는 AI 변환)"
        >
          {isImportingFrom1688 ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <ClipboardIcon className="h-5 w-5" />}
          <span className="text-[9px] leading-none font-semibold">복붙</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenDetailPageBuilder(lead)}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-blue-600 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-blue-500/10"
          aria-label="상세페이지 만들기"
          title="상세페이지 만들기 (사진 + 소구점 → AI 문구 생성)"
        >
          {isDetailPageDone ? <CheckIcon className="h-5 w-5 text-emerald-600" /> : <DocumentAddIcon className="h-5 w-5 mr-0" />}
          <span className="text-[9px] leading-none font-semibold">{isDetailPageDone ? '완료!' : '상세'}</span>
        </button>

        <button
          type="button"
          onClick={() => onIntegratedDownload(lead.id)}
          disabled={isIntegratedDownloading}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-amber-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-amber-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="통합 다운로드"
          title="상품명 폴더에 라벨(자동생성) + 대표/상세 이미지(zip) + 견적서를 한번에 다운로드 (준비된 항목만 저장)"
        >
          {isIntegratedDownloading ? (
            <SpinnerIcon className="h-5 w-5 animate-spin" />
          ) : isIntegratedDownloadDone ? (
            <CheckIcon className="h-5 w-5 text-emerald-600" />
          ) : (
            <SaveIcon />
          )}
          <span className="text-[9px] leading-none font-semibold">{isIntegratedDownloadDone ? '완료!' : '통합다운'}</span>
        </button>

        <button
          type="button"
          onClick={handleArchiveClick}
          className={`flex-shrink-0 transition-colors duration-200 p-1 rounded-md hover:bg-yellow-400/10 ${isArchiveDone ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
          aria-label="옵션 전체를 상품목록에 저장"
          title="URL/상품명/가격/바코드를 옵션 전체 상품목록에 저장 (나중에 검색해서 볼 수 있어요)"
        >
          {isArchiveDone ? <CheckIcon className="text-emerald-600" /> : <StarIcon />}
        </button>
      </div>
    </div>
  );
};

export default React.memo(ProductGroupSummary);
