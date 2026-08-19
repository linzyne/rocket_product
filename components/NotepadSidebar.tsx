import React, { useState, useEffect, useRef } from 'react';
import { TrashIcon, MemoIcon } from './Icons';

const STORAGE_KEY = 'stickyNoteContent';

const NotepadSidebar: React.FC = () => {
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const saveTimeoutRef = useRef<number | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setContent(saved);
    } catch (error) {
      console.error('Failed to load memo from localStorage', error);
    }
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, content);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1000);
      } catch (error) {
        console.error('Failed to save memo to localStorage', error);
      }
    }, 400);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [content]);

  const handleDelete = () => {
    if (!content) return;
    if (!window.confirm('메모를 삭제하시겠습니까?')) return;
    setContent('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to remove memo from localStorage', error);
    }
  };

  return (
    <aside className="flex flex-col w-80 shrink-0 sticky top-4 self-start bg-slate-800 rounded-xl shadow-2xl border border-slate-700 max-h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <MemoIcon />
          메모장
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs text-emerald-400 transition-opacity duration-300 ${saveStatus === 'saved' ? 'opacity-100' : 'opacity-0'}`}>
            저장됨
          </span>
          <button
            onClick={handleDelete}
            className="text-slate-400 hover:text-red-400 transition-colors"
            aria-label="메모 삭제"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="메모를 입력하세요..."
        className="flex-1 w-full p-4 bg-transparent text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none min-h-[300px]"
      />
    </aside>
  );
};

export default NotepadSidebar;
