
import React, { useState, useEffect, useCallback } from 'react';
import { CloseIcon } from './Icons';
import { QuoteFixedValues, DEFAULT_QUOTE_FIXED_VALUES } from '../data/quoteTemplates';

interface QuoteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  values: QuoteFixedValues;
  onSave: (values: QuoteFixedValues) => void;
}

const FIELDS: Array<{ key: keyof QuoteFixedValues; label: string; description?: string }> = [
  { key: 'brand', label: '브랜드' },
  { key: 'manufacturer', label: '제조사' },
  { key: 'dealType', label: '거래타입' },
  { key: 'importStatus', label: '수입여부' },
  { key: 'taxStatus', label: '과세여부' },
  { key: 'barcodeText', label: '상품바코드' },
  { key: 'shelfLifeDays', label: '유통기간(일수)' },
  { key: 'cautionReason', label: '취급주의사유' },
  { key: 'kcCertType', label: 'KC 인증마크타입' },
  { key: 'kcCertNumber', label: 'KC 인증번호' },
  { key: 'emcCertNumber', label: 'EMC 인증번호' },
  { key: 'safetyCertNumber', label: '안전기준적합확인신고번호' },
  { key: 'legalInfoFillValue', label: '상품 법적 정보', description: '견적서의 "상품 법적 정보" 병합 영역에 채워지는 값' },
  { key: 'sizeOverride', label: '사이즈(고정 컬럼)' },
];

const QuoteSettingsModal: React.FC<QuoteSettingsModalProps> = ({ isOpen, onClose, values, onSave }) => {
  const [draft, setDraft] = useState<QuoteFixedValues>(values);

  useEffect(() => {
    if (isOpen) {
      setDraft(values);
    }
  }, [isOpen, values]);

  const handleChange = (key: keyof QuoteFixedValues, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = useCallback(() => {
    onSave(draft);
    onClose();
  }, [draft, onSave, onClose]);

  const handleResetDefaults = useCallback(() => {
    setDraft(DEFAULT_QUOTE_FIXED_VALUES);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">견적서 고정값 설정</h2>
        <p className="text-sm text-slate-400 mb-6">견적서생성 시 상품마다 다르지 않고 항상 동일하게 채워지는 값입니다.</p>

        <div className="overflow-y-auto pr-1 space-y-4 flex-grow">
          {FIELDS.map(({ key, label, description }) => (
            <div key={key}>
              <label htmlFor={`quote-setting-${key}`} className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
              <input
                id={`quote-setting-${key}`}
                type="text"
                value={draft[key]}
                onChange={e => handleChange(key, e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
              />
              {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
            </div>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-slate-700 flex justify-between items-center">
          <button type="button" onClick={handleResetDefaults} className="text-sm text-slate-400 hover:text-slate-200 underline transition-colors">
            기본값으로 초기화
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
              취소
            </button>
            <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200">
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuoteSettingsModal;
