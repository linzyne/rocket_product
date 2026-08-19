
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Product } from '../types';
import { CloseIcon, DownloadIcon } from './Icons';
import { getQuoteTemplates, QuoteFixedValues, fillQuoteWorkbook, findMissingRequiredCells, ensureRequiredCustomFields, RequiredFieldGap } from '../data/quoteTemplates';
import { collectMissingFields, ProductMissingFields } from '../utils/productValidation';
import MissingFieldsModal from './MissingFieldsModal';

interface QuoteGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onProductsUpdate: (products: Product[]) => void;
  fixedValues: QuoteFixedValues;
}

const QuoteGeneratorModal: React.FC<QuoteGeneratorModalProps> = ({ isOpen, onClose, products, onProductsUpdate, fixedValues }) => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processedBuffer, setProcessedBuffer] = useState<ArrayBuffer | null>(null);
  const [fillStatus, setFillStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const quoteTemplates = useMemo(() => getQuoteTemplates(fixedValues), [fixedValues]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(quoteTemplates[0]?.id ?? '');
  const [missingFieldItems, setMissingFieldItems] = useState<ProductMissingFields[] | null>(null);
  const [requiredFieldGaps, setRequiredFieldGaps] = useState<RequiredFieldGap[] | null>(null);

  const resetState = useCallback(() => {
    setFile(null);
    setError(null);
    setIsDragging(false);
    setProcessedBuffer(null);
    setFillStatus('idle');
    setMissingFieldItems(null);
    setRequiredFieldGaps(null);
  }, []);

  const handleFile = (selectedFile: File | undefined) => {
    setProcessedBuffer(null);
    setFillStatus('idle');
    setError(null);

    if (selectedFile) {
      const allowedExtensions = ['.xlsx', '.xls'];
      const fileName = selectedFile.name.toLowerCase();
      const fileExtension = fileName.substring(fileName.lastIndexOf('.'));

      if (allowedExtensions.includes(fileExtension)) {
        setFile(selectedFile);
      } else {
        setError('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
        setFile(null);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const runFillData = useCallback(async () => {
    const template = quoteTemplates.find(t => t.id === selectedTemplateId);
    if (!file || !template) return;

    setFillStatus('processing');
    setError(null);
    setProcessedBuffer(null);

    try {
      const data = await file.arrayBuffer();

      // 이 견적서 파일이 필수로 요구하는 항목 중 아직 상품에 없는 항목은 자동으로 추가 항목
      // 칸을 만들어줍니다(출시 연도처럼 자동으로 정할 수 있는 값은 바로 채웁니다).
      const ensuredProducts = await ensureRequiredCustomFields(data, template, products);
      if (ensuredProducts.some((p, i) => p !== products[i])) {
        onProductsUpdate(ensuredProducts);
      }

      const requiredGaps = await findMissingRequiredCells(data, template, ensuredProducts);
      if (requiredGaps.length > 0) {
        setRequiredFieldGaps(requiredGaps);
        setFillStatus('idle');
        return;
      }

      const buffer = await fillQuoteWorkbook(data, template, ensuredProducts);

      setProcessedBuffer(buffer);
      setFillStatus('success');

    } catch (err) {
      console.error("Fill failed:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`파일 처리 중 오류가 발생했습니다: ${errorMessage}. 파일이 손상되지 않았는지, 양식이 올바른지 다시 확인해주세요.`);
      setFillStatus('error');
    }
  }, [file, products, selectedTemplateId, quoteTemplates, onProductsUpdate]);

  const handleFillData = useCallback(() => {
    if (!file) {
      setError('견적서 템플릿 파일을 업로드해주세요.');
      return;
    }

    const template = quoteTemplates.find(t => t.id === selectedTemplateId);
    if (!template) {
      setError('견적서 양식을 선택해주세요.');
      return;
    }

    const missing = collectMissingFields(products);
    if (missing.length > 0) {
      setMissingFieldItems(missing);
      return;
    }

    runFillData();
  }, [file, products, selectedTemplateId, quoteTemplates, runFillData]);

  const handleProceedDespiteMissingFields = useCallback(() => {
    setMissingFieldItems(null);
    runFillData();
  }, [runFillData]);

  const handleDownload = useCallback(async () => {
    if (fillStatus !== 'success' || !processedBuffer) {
        setError('먼저 "데이터 채우기"를 성공적으로 완료해야 합니다.');
        return;
    }
    try {
        const blob = new Blob([processedBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `견적서_데이터입력완료_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        onClose();
    } catch (err) {
        console.error("Download failed:", err);
        setError('다운로드 중 오류가 발생했습니다.');
    }
  }, [processedBuffer, fillStatus, onClose]);

  useEffect(() => {
    if (!isOpen) {
        resetState();
    }
  }, [isOpen, resetState]);
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 flex flex-col" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-6">견적서 데이터 자동 채우기</h2>
        
        <div className="space-y-6 flex-grow">
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">1. 견적서 양식 선택</label>
                <select
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                >
                  {quoteTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">2. 견적서 템플릿 파일 업로드</label>
                <label
                  htmlFor="file-upload"
                  className={`flex justify-center w-full px-6 pt-5 pb-6 border-2 border-dashed rounded-md cursor-pointer transition-colors duration-200 ${
                    isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-slate-600 hover:border-slate-500'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="space-y-1 text-center self-center">
                    <svg className="mx-auto h-12 w-12 text-slate-500" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="flex text-sm text-slate-300">
                      <p className="relative rounded-md font-medium text-purple-400 hover:text-purple-300">
                        <span>파일 선택</span>
                      </p>
                      <p className="pl-1">또는 파일을 여기에 드래그하세요</p>
                    </div>
                    <p className="text-xs text-slate-400">XLSX, XLS 파일만 가능</p>
                  </div>
                  <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".xlsx, .xls" />
                </label>
                {file && <p className="mt-2 text-sm font-medium text-green-400">선택된 파일: {file.name}</p>}
            </div>
            
            <div className="min-h-[6rem]">
              {fillStatus === 'success' && (
                <div className="text-sm text-green-300 bg-green-900/30 p-3 rounded-md">
                  <p className="font-bold">데이터 채우기 성공!</p>
                  <p>이제 아래 '다운로드' 버튼을 눌러 파일을 저장할 수 있습니다.</p>
                </div>
              )}
              {error && <p className="text-sm text-red-300 bg-red-900/30 p-3 rounded-md">{error}</p>}
            </div>
        </div>

        <div className="mt-8 pt-5 border-t border-slate-700 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
                취소
            </button>
            <button
                type="button"
                onClick={handleFillData}
                disabled={fillStatus === 'processing' || !file}
                className="flex items-center justify-center w-36 px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
                {fillStatus === 'processing' ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        채우는 중...
                    </>
                ) : (
                    '데이터 채우기'
                )}
            </button>
            <button
                type="button"
                onClick={handleDownload}
                disabled={fillStatus !== 'success'}
                className="flex items-center justify-center w-36 px-4 py-2 bg-purple-500 text-white font-semibold rounded-lg shadow-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
                <DownloadIcon />
                다운로드
            </button>
        </div>
      </div>

      <MissingFieldsModal
        isOpen={!!missingFieldItems}
        items={missingFieldItems ?? []}
        onCancel={() => setMissingFieldItems(null)}
        onProceedAnyway={handleProceedDespiteMissingFields}
      />

      <MissingFieldsModal
        isOpen={!!requiredFieldGaps}
        items={requiredFieldGaps ?? []}
        onCancel={() => setRequiredFieldGaps(null)}
        title="필수 항목이 비어 있습니다"
        description="업로드한 발주서 양식의 6행에 '필수'로 표시된 항목이 비어 있어 생성할 수 없습니다. 상품등록에서 값을 채운 뒤 다시 시도해주세요."
      />
    </div>
  );
};

export default QuoteGeneratorModal;
