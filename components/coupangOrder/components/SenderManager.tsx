import { useState } from 'react';
import type { SenderInfo } from '../types';

interface Props {
  sender: SenderInfo;
  onUpdate: (sender: SenderInfo) => void;
  onClose: () => void;
}

export default function SenderManager({ sender, onUpdate, onClose }: Props) {
  const [draft, setDraft] = useState<SenderInfo>(sender);

  const handleChange = (field: keyof SenderInfo, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onUpdate(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">보내는사람 정보</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            롯데택배 엑셀의 보내는사람(지정) 컬럼(B~F)에 매 행마다 자동으로 채워집니다.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">보내는사람</label>
            <input
              value={draft.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">전화번호1</label>
            <input
              value={draft.phone1}
              onChange={(e) => handleChange('phone1', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">전화번호2</label>
            <input
              value={draft.phone2}
              onChange={(e) => handleChange('phone2', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">우편번호</label>
            <input
              value={draft.zip}
              onChange={(e) => handleChange('zip', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">주소</label>
            <input
              value={draft.addr}
              onChange={(e) => handleChange('addr', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
