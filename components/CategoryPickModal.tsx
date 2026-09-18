import React from 'react';
import { CloseIcon } from './Icons';

interface CategoryPickModalProps {
  isOpen: boolean;
  /** 견적서 드롭다운에 들어 있는 카테고리 값들. */
  options: string[];
  /** 고른 값. 이 값이 견적서의 카테고리 칸에 그대로 들어간다. */
  onPick: (option: string) => void;
  onClose: () => void;
}

/**
 * 1688 창에서 받아둔 견적서를 상품에 붙일 때, 그 견적서에 카테고리가 여러 개 들어 있으면
 * 어느 값을 쓸지 여기서 고른다. 견적서의 카테고리 칸은 드롭다운이라 파일에 든 값 그대로여야
 * 해서, 사람이 임의로 적을 수 없다.
 */
const CategoryPickModal: React.FC<CategoryPickModalProps> = ({ isOpen, options, onPick, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full p-6 relative flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-xl font-bold text-slate-100 mb-1">카테고리 고르기</h2>
        <p className="text-sm text-slate-400 mb-4">
          받아온 견적서에 카테고리가 여러 개 들어 있습니다. 견적서에 넣을 값을 고르세요.
          (견적서 드롭다운에 있는 값 그대로 들어갑니다)
        </p>
        <div className="overflow-y-auto flex-grow min-h-0 -mx-1 px-1">
          {options.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => onPick(option)}
              className="w-full text-left px-3 py-2 mb-1.5 rounded-md bg-slate-700/60 hover:bg-blue-600 text-sm text-slate-200 hover:text-white transition-colors"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryPickModal;
