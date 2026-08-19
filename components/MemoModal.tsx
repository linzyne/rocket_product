import React, { useState, useEffect } from 'react';
import { CloseIcon } from './Icons';

interface MemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (memo: string) => void;
  initialMemo: string;
}

const MemoModal: React.FC<MemoModalProps> = ({ isOpen, onClose, onSave, initialMemo }) => {
  const [memo, setMemo] = useState(initialMemo);

  useEffect(() => {
    if (isOpen) {
      setMemo(initialMemo);
    }
  }, [isOpen, initialMemo]);

  const handleSave = () => {
    onSave(memo);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 flex flex-col" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-6">상품 메모</h2>
        
        <div className="flex-grow">
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full h-64 p-3 bg-slate-700 border border-slate-600 rounded-md text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="이 상품에 대한 메모를 입력하세요..."
            autoFocus
          />
        </div>

        <div className="mt-8 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
                닫기
            </button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200">
                저장
            </button>
        </div>
      </div>
    </div>
  );
};

export default MemoModal;