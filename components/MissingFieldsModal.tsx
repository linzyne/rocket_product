
import React from 'react';
import { CloseIcon } from './Icons';
import { ProductMissingFields } from '../utils/productValidation';

interface MissingFieldsModalProps {
  isOpen: boolean;
  items: ProductMissingFields[];
  onCancel: () => void;
  // 생략하면 "그래도 계속 진행" 버튼이 사라지고 닫기만 가능한 차단 모드로 동작합니다.
  onProceedAnyway?: () => void;
  title?: string;
  description?: string;
}

const MissingFieldsModal: React.FC<MissingFieldsModalProps> = ({ isOpen, items, onCancel, onProceedAnyway, title, description }) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4" onClick={handleBackdropClick}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 flex flex-col" onClick={e => e.stopPropagation()}>
        <button onClick={onCancel} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">{title ?? '입력하지 않은 항목이 있습니다'}</h2>
        <p className="text-sm text-slate-400 mb-6">
          {description ?? '아래 상품은 견적서에 채워질 항목이 비어 있습니다. 상품등록에서 먼저 채우는 것을 권장합니다.'}
        </p>

        <div className="flex-grow max-h-80 overflow-y-auto space-y-3 pr-1">
          {items.map(({ product, missing }, index) => (
            <div key={product.id} className="bg-slate-700/50 border border-slate-600 rounded-lg p-3">
              <p className="text-sm font-semibold text-slate-200 mb-1">
                {index + 1}. {product.productName || '(상품명 없음)'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missing.map(label => (
                  <span key={label} className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-800">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-5 border-t border-slate-700 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
            {onProceedAnyway ? '취소하고 채우러 가기' : '확인'}
          </button>
          {onProceedAnyway && (
            <button type="button" onClick={onProceedAnyway} className="px-4 py-2 bg-amber-500 text-white font-semibold rounded-lg shadow-md hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all duration-200">
              그래도 계속 진행
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MissingFieldsModal;
