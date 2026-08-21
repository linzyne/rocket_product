
import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../types';
import { TrashIcon, ImageIcon, CopyIcon, UploadIcon, MemoIcon, CalculatorIcon, CopyFromAboveIcon, DownloadIcon, SpinnerIcon, SparklesIcon, ChevronDownIcon, DocumentAddIcon, ImageEditIcon, CloseIcon, ClipboardIcon, SaveIcon, ExternalLinkIcon, CheckIcon } from './Icons';
import ProductCustomFields from './ProductCustomFields';
import { QuoteTemplateRegistration } from '../data/quoteTemplates';
import { CATEGORY_PRESETS } from '../data/categoryPresets';
import { saveBlobInProductFolder, saveDataUrlsAsZipInProductFolder, productFolderName, getRootDirectory } from '../utils/fileSave';
import { withCoLtdSuffix } from '../utils/manufacturerFormat';

interface ProductRowProps {
  product: Product;
  displayIndex: number;
  onProductChange: (id: string, field: keyof Product, value: string) => void;
  onRemoveProduct: (id: string) => void;
  onDuplicateProduct: (id: string) => void;
  onGenerateLabel: (product: Product) => void;
  onOpenMemoModal: (product: Product) => void;
  onOpenMarginCalculator: (id: string) => void;
  onCopyFromAbove: (id: string) => void;
  onOpenTranslation: (imageDataUrl: string | undefined, field: 'thumbnailDataUrl' | 'detailDataUrl') => void;
  onOpenImageEditor: (product: Product) => void;
  onOpenDetailPageBuilder: (product: Product) => void;
  onMenuToggle: (isOpen: boolean) => void;
  onSetCustomField: (id: string, name: string, value: string) => void;
  onRemoveCustomField: (id: string, name: string) => void;
  onTogglePackageSizeSameAsProduct: (id: string, sameAsProduct: boolean) => void;
  quoteTemplateRegistrations: QuoteTemplateRegistration[];
  onGenerateProductQuote: (id: string) => void;
  isGeneratingQuote: boolean;
  onImportProductQuote: (id: string, file: File) => void;
  isImportingQuote: boolean;
  onImportFrom1688: (id: string) => void;
  isImportingFrom1688: boolean;
  use1688AiTranslation: boolean;
  onToggle1688AiTranslation: () => void;
  onImportMarginFromClipboard: (id: string) => void;
  registeredCategories: string[];
  onIntegratedDownload: (id: string) => void;
  isIntegratedDownloading: boolean;
  isIntegratedDownloadDone: boolean;
}

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className = '', children }) => (
  <div className={`flex flex-col gap-1 min-w-0 ${className}`}>
    <label className="text-[10px] font-medium text-gray-400 px-0.5 whitespace-nowrap overflow-hidden text-ellipsis" title={label}>{label}</label>
    {children}
  </div>
);

const ProductRow: React.FC<ProductRowProps> = ({
  product,
  displayIndex,
  onProductChange,
  onRemoveProduct,
  onDuplicateProduct,
  onGenerateLabel,
  onOpenMemoModal,
  onOpenMarginCalculator,
  onCopyFromAbove,
  onOpenTranslation,
  onOpenImageEditor,
  onOpenDetailPageBuilder,
  onMenuToggle,
  onSetCustomField,
  onRemoveCustomField,
  onTogglePackageSizeSameAsProduct,
  quoteTemplateRegistrations,
  onGenerateProductQuote,
  isGeneratingQuote,
  onImportProductQuote,
  isImportingQuote,
  onImportFrom1688,
  isImportingFrom1688,
  use1688AiTranslation,
  onToggle1688AiTranslation,
  onImportMarginFromClipboard,
  registeredCategories,
  onIntegratedDownload,
  isIntegratedDownloading,
  isIntegratedDownloadDone,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isZippingImages, setIsZippingImages] = useState(false);
  const [isZipDone, setIsZipDone] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onProductChange(product.id, name as keyof Product, value);
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    onProductChange(product.id, name as keyof Product, value);
  };

  const handleNumericChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (/^\d*\.?\d*$/.test(value)) {
      onProductChange(product.id, name as keyof Product, value);
    }
  };

  const handleIntegerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (/^\d*$/.test(value)) {
      onProductChange(product.id, name as keyof Product, value);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const handleManufacturerBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const withSuffix = withCoLtdSuffix(e.target.value);
    if (withSuffix !== product.manufacturer) {
      onProductChange(product.id, 'manufacturer', withSuffix);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, field: 'thumbnailFile' | 'detailFile' | 'labelFile') => {
    const file = e.target.files?.[0];
    if (file) {
      onProductChange(product.id, field, file.name);

      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          const dataUrlField = field === 'thumbnailFile' ? 'thumbnailDataUrl' : field === 'detailFile' ? 'detailDataUrl' : 'labelDataUrl';
          onProductChange(product.id, dataUrlField as keyof Product, reader.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleDownloadImagesZip = async () => {
    if (isZippingImages) return;
    const files: { name: string; dataUrl: string }[] = [];
    if (product.thumbnailDataUrl) files.push({ name: product.thumbnailFile || '대표.png', dataUrl: product.thumbnailDataUrl });
    if (product.detailDataUrl) files.push({ name: product.detailFile || '상세.png', dataUrl: product.detailDataUrl });
    if (files.length === 0) {
      alert('대표 이미지 또는 상세 이미지가 없습니다.');
      return;
    }
    // 필드에 파일명만 채워져 있고 실제 이미지 데이터(dataUrl)는 없는 경우가 있어(예: 기본 파일명만
    // 자동 생성되고 아직 업로드/생성은 안 한 상태), 하나만 있을 때 조용히 1개짜리 zip을 만들지 않고
    // 미리 알려서 사용자가 원하면 취소하고 나머지를 먼저 채울 수 있게 한다.
    if (files.length < 2) {
      const missing = !product.thumbnailDataUrl ? '대표 이미지' : '상세 이미지';
      const proceed = window.confirm(`${missing}가 없어서 ${files[0].name} 1개만 압축됩니다. 계속할까요?`);
      if (!proceed) return;
    }
    setIsZippingImages(true);
    try {
      // 폴더 접근 권한을 클릭 직후 가장 먼저 요청한다. showDirectoryPicker는 "user activation"이
      // 있어야 동작하는데, zip 압축처럼 시간이 걸리는 비동기 작업을 먼저 거치면 그 활성 상태가
      // 소멸해 조용히 실패(버튼 클릭해도 무반응)할 수 있다.
      await getRootDirectory();
      await saveDataUrlsAsZipInProductFolder(files, productFolderName(product), `${productFolderName(product)}_이미지.zip`);
      // 저장 자체는 대부분 조용히(다이얼로그 없이) 끝나서 사용자 눈에는 버튼이 아무 반응도
      // 안 한 것처럼 보일 수 있다. 잠깐 체크 아이콘으로 바꿔 완료됐다는 걸 알려준다.
      setIsZipDone(true);
      setTimeout(() => setIsZipDone(false), 1500);
    } catch (err) {
      console.error('이미지 압축 다운로드 실패:', err);
      alert('이미지를 압축하는 중 오류가 발생했습니다.');
    } finally {
      setIsZippingImages(false);
    }
  };

  const handleImportQuoteFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportProductQuote(product.id, file);
    }
    e.target.value = '';
  };

  const handleDownloadFromUrl = async () => {
    if (!product.url) {
      alert('다운로드할 URL이 없습니다.');
      return;
    }

    setIsDownloading(true);
    try {
      const response = await fetch(product.url);
      if (!response.ok) throw new Error('Network response was not ok');

      const blob = await response.blob();
      const extension = product.url.split('.').pop()?.split(/[?#]/)[0] || 'jpg';
      const fileName = `${product.productName || 'product'}_${product.color || ''}_image.${extension}`;
      await saveBlobInProductFolder(blob, productFolderName(product), fileName, blob.type || 'image/jpeg');
    } catch (error) {
      console.error('Image download failed (possibly CORS):', error);
      if (confirm('해당 사이트의 보안 정책으로 인해 직접 다운로드가 차단되었습니다.\n이미지를 새 창에서 열어 수동으로 저장하시겠습니까?')) {
        window.open(product.url, '_blank');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenUrl = () => {
    if (!product.url) return;
    const href = /^https?:\/\//i.test(product.url) ? product.url : `https://${product.url}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleSelectPreset = (fullPath: string) => {
    onProductChange(product.id, 'category', fullPath);
    setShowCategoryMenu(false);
    onMenuToggle(false);
  };

  const toggleCategoryMenu = () => {
    const newState = !showCategoryMenu;
    setShowCategoryMenu(newState);
    onMenuToggle(newState);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target as Node)) {
        setShowCategoryMenu(false);
        onMenuToggle(false);
      }
    };
    if (showCategoryMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCategoryMenu, onMenuToggle]);

  const inputClass = "w-full px-3 py-1 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200";
  const numericInputClass = `${inputClass} text-right`;
  const fileInputClass = "w-full px-2 py-0.5 text-xs bg-white border border-gray-200 rounded-md text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition duration-200";
  const searchInputClass = inputClass.replace('text-gray-900', 'text-gray-400');
  const hiddenTextSelectClass = `${inputClass} truncate text-transparent`;

  const formatNumber = (value: string | number) => Number(value || 0).toLocaleString();

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:border-gray-300 transition-colors duration-150">
      {/* Top bar: index, quick actions, thumbnail, url, category, quote, detail page, search keyword, integrated download, management */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 border-b border-gray-200">
        <span className="flex-shrink-0 w-6 text-center text-sm font-semibold text-gray-500">{displayIndex + 1}</span>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <label
            className={`relative flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-teal-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-teal-500/10 cursor-pointer ${isImportingQuote ? 'opacity-50 pointer-events-none' : ''}`}
            title="채워진 견적서 파일을 업로드해서 이 상품 필드에 값 채우기"
          >
            {isImportingQuote ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <UploadIcon className="h-5 w-5" />}
            <span className="text-[9px] leading-none font-semibold">채우기</span>
            <input type="file" className="sr-only" onChange={handleImportQuoteFile} accept=".xlsx, .xls" />
          </label>
          <button
            onClick={() => onOpenMemoModal(product)}
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-amber-100 ${product.memo ? 'text-amber-600 hover:text-amber-700' : 'text-gray-400 hover:text-gray-900'}`}
            aria-label="Product Memo"
            title="메모"
          >
            <MemoIcon />
            <span className="text-[9px] leading-none font-semibold">메모</span>
          </button>
          <button
            onClick={() => onDuplicateProduct(product.id)}
            className="text-gray-400 hover:text-green-700 transition-colors duration-200 p-1 rounded-md hover:bg-green-500/10"
            aria-label="Duplicate Product"
            title="복사"
          >
            <CopyIcon />
          </button>
          {displayIndex > 0 && (
            <button
              onClick={() => onCopyFromAbove(product.id)}
              className="text-gray-400 hover:text-sky-700 transition-colors duration-200 p-1 rounded-md hover:bg-sky-500/10"
              aria-label="Copy from above"
              title="윗줄복사"
            >
              <CopyFromAboveIcon />
            </button>
          )}
        </div>

        <div className="w-9 h-9 flex-shrink-0 bg-gray-100 rounded-md flex items-center justify-center overflow-hidden border border-gray-200 text-gray-400">
          {product.thumbnailDataUrl ? (
            <img src={product.thumbnailDataUrl} alt={product.productName} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon />
          )}
        </div>

        <div className="flex-1 basis-[140px] min-w-[140px]">
          <div className="relative flex items-center">
            <input
              type="text"
              name="url"
              value={product.url}
              onChange={handleChange}
              onFocus={handleFocus}
              className={`${hiddenTextSelectClass} pr-7`}
              placeholder="URL"
            />
            <button
              type="button"
              onClick={handleOpenUrl}
              disabled={!product.url}
              className="absolute right-1 text-gray-400 hover:text-blue-600 p-1 rounded-full hover:bg-blue-500/10 transition-colors duration-200 disabled:opacity-30"
              title="URL 새 탭에서 열기"
            >
              <ExternalLinkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-w-[120px]" ref={categoryMenuRef}>
          <div className="relative flex items-center">
            <input
              type="text"
              name="category"
              value={product.category}
              onChange={handleChange}
              onFocus={handleFocus}
              className={`${inputClass} pr-7 overflow-hidden text-ellipsis`}
              placeholder="카테고리"
            />
            <button
              onClick={toggleCategoryMenu}
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

        <div className="flex-1 min-w-[120px]">
          <select
            name="quoteTemplateId"
            value={product.quoteTemplateId}
            onChange={handleSelectChange}
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
          onClick={() => onImportFrom1688(product.id)}
          disabled={isImportingFrom1688}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-orange-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-orange-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="1688에서 붙여넣기"
          title="1688 캡처 확장프로그램으로 복사한 데이터를 붙여넣기 (옵션이 여러 개면 그 개수만큼 상품행 자동 생성 · URL/중량은 공통, 원가/사이즈/노출속성은 옵션별로 반영, 상품명/제조사/검색어는 AI 변환)"
        >
          {isImportingFrom1688 ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <ClipboardIcon className="h-5 w-5" />}
          <span className="text-[9px] leading-none font-semibold">복붙</span>
        </button>

        <button
          onClick={() => onOpenDetailPageBuilder(product)}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-blue-600 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-blue-500/10"
          aria-label="상세페이지 만들기"
          title="상세페이지 만들기 (사진 + 소구점 → AI 문구 생성)"
        >
          <DocumentAddIcon className="h-5 w-5 mr-0" />
          <span className="text-[9px] leading-none font-semibold">상세</span>
        </button>

        <button
          onClick={() => onIntegratedDownload(product.id)}
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

        <div className="flex items-center gap-0.5 flex-shrink-0 ml-auto">
          <button
            onClick={() => onRemoveProduct(product.id)}
            className="text-gray-400 hover:text-red-500 transition-colors duration-200 p-1 rounded-md hover:bg-red-500/10"
            aria-label="Remove product"
            title="삭제"
          >
            <TrashIcon />
          </button>
        </div>

        <button
          onClick={() => setShowDetails(v => !v)}
          className="flex-shrink-0 flex items-center justify-center p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
          aria-label={showDetails ? '나머지 항목 접기' : '나머지 항목 더보기'}
          title={showDetails ? '접기' : '더보기'}
        >
          <span className={`inline-block transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`}>
            <ChevronDownIcon />
          </span>
        </button>
      </div>

      <div className={`px-4 pt-2 ${showDetails ? '' : 'pb-3'}`}>
        <input
          type="text"
          name="searchKeyword"
          value={product.searchKeyword}
          onChange={handleChange}
          onFocus={handleFocus}
          className={searchInputClass}
          placeholder="검색어"
        />
      </div>

      {showDetails && (
      <>
      <div className="flex items-center gap-0.5 px-4 pt-2">
        <button
          onClick={() => onImportMarginFromClipboard(product.id)}
          className="flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-emerald-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-emerald-500/10"
          aria-label="수익 계산기 확장프로그램에서 붙여넣기"
          title="확장프로그램의 수익 계산기 팝업에서 복사한 원가/공급가/판매가/마진을 붙여넣기"
        >
          <CalculatorIcon />
          <span className="text-[9px] leading-none font-semibold">마진</span>
        </button>
        <label
          className="flex flex-col items-center justify-center gap-0.5 px-1 py-0.5 rounded-md cursor-pointer select-none text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
          title="켜면 1688 붙여넣기 시 AI(Gemini)로 상품명/제조사/색상을 번역합니다. 끄면 AI 호출 없이 원문 그대로 채워서 비용이 들지 않습니다."
        >
          <input
            type="checkbox"
            checked={use1688AiTranslation}
            onChange={onToggle1688AiTranslation}
            className="w-3.5 h-3.5 accent-orange-400"
          />
          <span className="text-[9px] leading-none font-semibold">AI</span>
        </label>
        <button
          onClick={() => onGenerateProductQuote(product.id)}
          disabled={!product.quoteTemplateId || isGeneratingQuote}
          className="flex flex-col items-center justify-center gap-0.5 text-blue-600 hover:text-blue-700 transition-colors duration-200 px-1.5 py-0.5 rounded-md hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Generate quote for this product"
          title="이 상품 견적서 생성 (라벨이 등록되어 있으면 함께 다운로드됩니다)"
        >
          {isGeneratingQuote ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <DocumentAddIcon className="h-5 w-5" />}
          <span className="text-[9px] leading-none font-semibold">견적서</span>
        </button>
      </div>
      {/* Row 1: identity & pricing */}
      <div className="flex flex-wrap gap-2 px-4 pt-2">
        <Field label="제조사" className="flex-1 basis-[110px]">
          <input type="text" name="manufacturer" value={product.manufacturer} onChange={handleChange} onFocus={handleFocus} onBlur={handleManufacturerBlur} className={inputClass} />
        </Field>

        <Field label="상품명" className="flex-[2] basis-[200px]">
          <input type="text" name="productName" value={product.productName} onChange={handleChange} onFocus={handleFocus} className={inputClass} />
        </Field>

        <Field label="원가" className="flex-1 basis-[95px] relative group">
          <div className="relative flex items-center">
            <input type="text" name="costPrice" value={product.costPrice} onChange={handleNumericChange} onFocus={handleFocus} className={`${numericInputClass} pr-8`} />
            <button
              onClick={() => onOpenMarginCalculator(product.id)}
              className="absolute right-1 text-gray-400 hover:text-blue-600 p-1 rounded-full hover:bg-blue-500/10 transition-colors duration-200"
              aria-label="Open Margin Calculator"
            >
              <CalculatorIcon />
            </button>
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 left-full ml-2 w-max p-3 bg-white border border-gray-300 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
            <div className="flex items-center space-x-4 text-sm whitespace-nowrap">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-gray-400">공급가:</span>
                <span className="text-emerald-600 font-mono">{formatNumber(product.supplyPrice)}원</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-semibold text-gray-400">판매가:</span>
                <span className="text-emerald-600 font-mono">{formatNumber(product.sellingPrice)}원</span>
              </div>
              <div className="flex items-center gap-1 border-l border-gray-200 pl-3">
                <span className="font-semibold text-gray-400">마진:</span>
                <span className="text-green-700 font-mono">{formatNumber(product.margin)}원</span>
              </div>
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 left-[-6px] w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-gray-300"></div>
          </div>
        </Field>

        <Field label="수량" className="flex-1 basis-[80px]">
          <input type="text" name="quantity" value={product.quantity} onChange={handleIntegerChange} onFocus={handleFocus} className={numericInputClass} />
        </Field>

        <Field label="색상" className="flex-1 basis-[85px]">
          <input type="text" name="color" value={product.color} onChange={handleChange} onFocus={handleFocus} className={inputClass} placeholder="예: 레드" />
        </Field>

        <Field label="SKU" className="flex-1 basis-[70px]">
          <input type="text" name="sku" value={product.sku} onChange={handleChange} onFocus={handleFocus} className={inputClass} placeholder="예: JNL-001" />
        </Field>

        <Field label="중량(g)" className="basis-[75px]">
          <div className="relative">
            <input type="text" inputMode="decimal" name="weight" value={product.weight} onChange={handleNumericChange} onFocus={handleFocus} className={`${numericInputClass} pr-5`} />
            <span className="absolute inset-y-0 right-1.5 flex items-center text-gray-400 text-xs">g</span>
          </div>
        </Field>

      </div>

      {/* Row 2: specs, files & options */}
      <div className="flex flex-wrap gap-2 px-4 pb-3 pt-2">
        <Field label="사이즈(cm)" className="flex-[1.4] basis-[150px]">
          <div className="flex gap-1">
            <input type="text" inputMode="decimal" name="sizeWidth" value={product.sizeWidth} onChange={handleNumericChange} onFocus={handleFocus} className={`${numericInputClass} flex-1`} placeholder="가로" />
            <input type="text" inputMode="decimal" name="sizeHeight" value={product.sizeHeight} onChange={handleNumericChange} onFocus={handleFocus} className={`${numericInputClass} flex-1`} placeholder="세로" />
            <input type="text" inputMode="decimal" name="sizeDepth" value={product.sizeDepth} onChange={handleNumericChange} onFocus={handleFocus} className={`${numericInputClass} flex-1`} placeholder="높이" />
          </div>
        </Field>

        <Field label="한 개 단품 포장 사이즈" className="flex-[1.2] basis-[160px]">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              name="packageSize"
              value={product.packageSizeSameAsProduct
                ? [product.sizeWidth, product.sizeHeight, product.sizeDepth].filter(Boolean).join('*')
                : product.packageSize}
              onChange={handleChange}
              onFocus={handleFocus}
              disabled={product.packageSizeSameAsProduct}
              className={`${inputClass} flex-1 disabled:opacity-60 disabled:cursor-not-allowed`}
              placeholder="가로*세로*높이"
            />
            <label className="flex items-center gap-1 flex-shrink-0 text-[11px] text-gray-400 whitespace-nowrap cursor-pointer" title="상품 사이즈(가로/세로/높이)와 동일한 값을 자동으로 사용">
              <input
                type="checkbox"
                checked={product.packageSizeSameAsProduct}
                onChange={e => onTogglePackageSizeSameAsProduct(product.id, e.target.checked)}
                className="accent-blue-500"
              />
              동일
            </label>
          </div>
        </Field>

        <Field label="대표 이미지" className="basis-[104px]">
          <div className="relative flex items-center">
            <label htmlFor={`thumbnail-file-upload-${product.id}`} className="absolute left-1 z-10 text-gray-400 hover:text-blue-600 cursor-pointer p-1 rounded-full hover:bg-blue-500/20 transition-colors">
              <UploadIcon />
            </label>
            <input type="file" id={`thumbnail-file-upload-${product.id}`} className="sr-only" onChange={(e) => handleFileSelect(e, 'thumbnailFile')} accept="image/*" />
            <input type="text" name="thumbnailFile" value={product.thumbnailFile} onChange={handleChange} onFocus={handleFocus} className={`${fileInputClass} pl-8 ${product.thumbnailDataUrl ? 'pr-6' : 'pr-2'}`} placeholder="대표" />
            {product.thumbnailDataUrl && (
              <button
                onClick={() => onOpenTranslation(product.thumbnailDataUrl, 'thumbnailDataUrl')}
                className="absolute right-1 text-blue-600 hover:text-blue-700 transition-colors"
                title="이미지 내 텍스트 번역"
              >
                <SparklesIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </Field>

        <Field label="상세 이미지" className="basis-[104px]">
          <div className="relative flex items-center">
            <label htmlFor={`detail-file-upload-${product.id}`} className="absolute left-1 z-10 text-gray-400 hover:text-blue-600 cursor-pointer p-1 rounded-full hover:bg-blue-500/20 transition-colors">
              <UploadIcon />
            </label>
            <input type="file" id={`detail-file-upload-${product.id}`} className="sr-only" onChange={(e) => handleFileSelect(e, 'detailFile')} accept="image/*" />
            <input type="text" name="detailFile" value={product.detailFile} onChange={handleChange} onFocus={handleFocus} className={`${fileInputClass} pl-8 ${product.detailDataUrl ? 'pr-6' : 'pr-2'}`} placeholder="상세" />
            {product.detailDataUrl && (
              <button
                onClick={() => onOpenTranslation(product.detailDataUrl, 'detailDataUrl')}
                className="absolute right-1 text-blue-600 hover:text-blue-700 transition-colors"
                title="이미지 내 텍스트 번역"
              >
                <SparklesIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </Field>

        <Field label="제품 필수 표시사항" className="basis-[104px]">
          <div className="relative flex items-center">
            <label htmlFor={`label-file-upload-${product.id}`} className="absolute left-1 z-10 text-gray-400 hover:text-blue-600 cursor-pointer p-1 rounded-full hover:bg-blue-500/20 transition-colors">
              <UploadIcon />
            </label>
            <input type="file" id={`label-file-upload-${product.id}`} className="sr-only" onChange={(e) => handleFileSelect(e, 'labelFile')} accept="image/*" />
            <input type="text" name="labelFile" value={product.labelFile} onChange={handleChange} onFocus={handleFocus} className={`${fileInputClass} pl-8`} placeholder="라벨/도안" />
          </div>
        </Field>

        <Field label="이미지 ZIP" className="basis-[44px]">
          <button
            onClick={handleDownloadImagesZip}
            disabled={isZippingImages || (!product.thumbnailDataUrl && !product.detailDataUrl)}
            className="w-full flex items-center justify-center px-2 py-1 bg-white border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 hover:text-emerald-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:mr-0"
            title="대표 이미지 + 상세 이미지 압축(zip) 다운로드"
          >
            {isZippingImages ? (
              <SpinnerIcon className="animate-spin" />
            ) : isZipDone ? (
              <CheckIcon className="text-emerald-600" />
            ) : (
              <DownloadIcon />
            )}
          </button>
        </Field>

        <Field label="라벨" className="basis-[44px]">
          <button
            onClick={() => onGenerateLabel(product)}
            className="w-full flex items-center justify-center px-2 py-1 bg-white border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 hover:text-blue-700 transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5"
            title="라벨 생성"
          >
            <ImageIcon />
          </button>
        </Field>

        {Object.entries(product.customFields).map(([name, value]) => (
          <Field key={name} label={name} className="basis-[100px]">
            <div className="relative">
              <input
                type="text"
                value={value}
                onChange={e => onSetCustomField(product.id, name, e.target.value)}
                onFocus={handleFocus}
                className={`${inputClass} pr-6`}
              />
              <button
                onClick={() => onRemoveCustomField(product.id, name)}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded-full hover:bg-red-500/10 [&_svg]:h-3.5 [&_svg]:w-3.5"
                aria-label={`${name} 항목 삭제`}
                title={`${name} 항목 삭제`}
              >
                <CloseIcon />
              </button>
            </div>
          </Field>
        ))}

        <Field label="이미지 편집" className="basis-[44px]">
          <button
            onClick={() => onOpenImageEditor(product)}
            className="w-full flex items-center justify-center px-2 py-1 bg-white border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 hover:text-blue-700 transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5"
            title="이미지 에디터 (합치기 / 텍스트 삭제 / 텍스트 추가 / 브러쉬 지우개)"
          >
            <ImageEditIcon />
          </button>
        </Field>

        <Field label="추가항목" className="basis-[44px]">
          <ProductCustomFields
            fields={product.customFields}
            onSetField={(name, value) => onSetCustomField(product.id, name, value)}
            onMenuToggle={onMenuToggle}
          />
        </Field>
      </div>
      </>
      )}
    </div>
  );
};

export default React.memo(ProductRow);
