
import React, { useState, useRef, useEffect } from 'react';
import { PlusIcon } from './Icons';
import { getAutoCustomFieldValue } from '../data/quoteTemplates';

interface ProductCustomFieldsProps {
  fields: { [key: string]: string };
  onSetField: (name: string, value: string) => void;
  onMenuToggle: (isOpen: boolean) => void;
}

const ProductCustomFields: React.FC<ProductCustomFieldsProps> = ({ fields, onSetField, onMenuToggle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const setOpen = (next: boolean) => {
    setIsOpen(next);
    onMenuToggle(next);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (fields[trimmed] !== undefined) {
      alert('이미 있는 항목 이름입니다.');
      return;
    }
    onSetField(trimmed, getAutoCustomFieldValue(trimmed));
    setNewName('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!isOpen)}
        className="relative w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs whitespace-nowrap bg-slate-700 border border-slate-600 rounded-md text-slate-300 hover:bg-slate-600 hover:text-white transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5"
        title="새 추가 항목 만들기"
      >
        <PlusIcon />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] z-[9999] py-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-3 py-1.5 border-b border-slate-700 bg-slate-700/30 mb-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">새 추가 항목 만들기</span>
          </div>

          <div className="px-3 pt-2 mt-1 flex gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="항목 이름 (예: 높이)"
              autoFocus
              className="flex-1 min-w-0 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            />
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-md hover:bg-blue-600 transition-colors flex-shrink-0"
            >
              추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCustomFields;
