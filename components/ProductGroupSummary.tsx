
import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../types';
import { ImageIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, ClipboardIcon, DocumentAddIcon, SaveIcon, StarIcon, CheckIcon, SpinnerIcon, SearchIcon } from './Icons';

interface ProductGroupSummaryProps {
  groupIndex: number;
  products: Product[];
  isExpanded: boolean;
  onToggle: () => void;
  onProductChange: (id: string, field: keyof Product, value: string) => void;
  onImportFrom1688: (id: string) => void;
  /** 상품명 키워드로 쿠팡 카테고리 견적서를 찾아 등록하는 모달을 엽니다. */
  onOpenCategoryFinder: (id: string) => void;
  isImportingFrom1688: boolean;
  onOpenDetailPageBuilder: (product: Product) => void;
  isDetailPageDone: boolean;
  onIntegratedDownload: (id: string) => void;
  isIntegratedDownloading: boolean;
  isIntegratedDownloadDone: boolean;
  onArchiveGroup: (products: Product[]) => boolean;
  // 통합다운 후 "상품목록에 저장할까요?" 확인을 눌러 자동 저장됐을 때 부모가 잠깐 true로 켜주는 값.
  isArchiveDoneExternal?: boolean;
}

const inputClass = "w-full px-3 py-1 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200";


// 작업 순서를 그대로 보여주는 큰 버튼. 번호 + 이모지 + 이름을 함께 둬서 "지금 몇 번째인지"가
// 한눈에 들어오게 하고, 끝난 단계는 초록 체크로 바뀐다.
const STEP_TONES: Record<string, string> = {
  orange: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300',
  blue: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300',
};

const StepButton: React.FC<{
  step: string;
  label: string;
  emoji: string;
  tone: keyof typeof STEP_TONES;
  onClick: () => void;
  title: string;
  busy?: boolean;
  done?: boolean;
}> = ({ step, label, emoji, tone, onClick, title, busy, done }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    title={title}
    aria-label={`${step} ${label}`}
    className={`relative flex-1 min-w-[64px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl border-2 transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
      done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : STEP_TONES[tone]
    }`}
  >
    <span className="text-[10px] font-extrabold leading-none opacity-60">{step}</span>
    <span className="text-xl leading-none">
      {busy ? <SpinnerIcon className="h-5 w-5 animate-spin" /> : emoji}
    </span>
    <span className="text-[11px] font-bold leading-none">{label}</span>
    {/* 끝난 단계는 어떤 단계였는지도 계속 보이게, 이모지를 바꾸지 않고 체크 배지를 얹는다. */}
    {done && !busy && (
      <span className="absolute -top-2 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm">
        ✓
      </span>
    )}
  </button>
);

const ProductGroupSummary: React.FC<ProductGroupSummaryProps> = ({
  groupIndex,
  products,
  isExpanded,
  onToggle,
  onProductChange,
  onImportFrom1688,
  onOpenCategoryFinder,
  isImportingFrom1688,
  onOpenDetailPageBuilder,
  isDetailPageDone,
  onIntegratedDownload,
  isIntegratedDownloading,
  isIntegratedDownloadDone,
  onArchiveGroup,
  isArchiveDoneExternal = false,
}) => {
  const lead = products[0];
  const thumbnail = products.find(p => p.thumbnailDataUrl)?.thumbnailDataUrl;
  const optionCount = products.length;
  const colors = Array.from(new Set(products.map(p => p.color.trim()).filter(Boolean)));

  const [isArchiveDone, setIsArchiveDone] = useState(false);

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

        {/* 작업 순서 그대로: 01 복붙 → 02 견적서 → 03 상페 → 04 등록.
            카테고리와 견적서는 02에서 자동으로 정해지므로 입력칸을 따로 두지 않는다. */}
        <div className="flex-1 flex items-stretch gap-2 min-w-0">
          <StepButton
            step="01"
            label="복붙"
            emoji="📋"
            tone="orange"
            busy={isImportingFrom1688}
            done={!!lead.productName && !!lead.url}
            onClick={() => onImportFrom1688(lead.id)}
            title="1688 캡처 확장에서 복사한 값을 붙여넣기 (옵션 개수만큼 상품행이 자동으로 생깁니다)"
          />
          <StepButton
            step="02"
            label="견적서"
            emoji="🔍"
            tone="blue"
            done={!!lead.quoteTemplateId}
            onClick={() => onOpenCategoryFinder(lead.id)}
            title="상품명 키워드로 쿠팡 카테고리를 찾아 견적서 양식을 자동으로 받아옵니다 (쿠팡 로그인 필요)"
          />
          <StepButton
            step="03"
            label="상페"
            emoji="🎨"
            tone="violet"
            done={isDetailPageDone || !!lead.detailDataUrl}
            onClick={() => onOpenDetailPageBuilder(lead)}
            title="상세페이지 만들기 (사진 + 문구)"
          />
          <StepButton
            step="04"
            label="등록"
            emoji="🚀"
            tone="emerald"
            busy={isIntegratedDownloading}
            done={isIntegratedDownloadDone || !!lead.integratedDownloadedAt}
            onClick={() => onIntegratedDownload(lead.id)}
            title="라벨·이미지·견적서를 상품명 폴더에 저장하고, 이어서 쿠팡에 제안합니다"
          />
        </div>

        <button
          type="button"
          onClick={handleArchiveClick}
          className={`flex-shrink-0 transition-colors duration-200 p-1 rounded-md hover:bg-yellow-400/10 ${isArchiveDone || isArchiveDoneExternal ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
          aria-label="옵션 전체를 상품목록에 저장"
          title="URL/상품명/가격/바코드를 옵션 전체 상품목록에 저장 (나중에 검색해서 볼 수 있어요)"
        >
          {isArchiveDone || isArchiveDoneExternal ? <CheckIcon className="text-emerald-600" /> : <StarIcon />}
        </button>
      </div>
    </div>
  );
};

export default React.memo(ProductGroupSummary);
