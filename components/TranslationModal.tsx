
import React, { useState, useEffect } from 'react';
import { CloseIcon, SpinnerIcon, SparklesIcon, SaveIcon } from './Icons';
import { editImageWithGemini } from '../utils/geminiImageEdit';

interface TranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveImage: (newDataUrl: string) => void;
  imageDataUrl: string | undefined;
}

const TranslationModal: React.FC<TranslationModalProps> = ({ isOpen, onClose, onSaveImage, imageDataUrl }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [editedImageDataUrl, setEditedImageDataUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && imageDataUrl) {
      handleImageTranslation();
    } else {
      setEditedImageDataUrl(null);
      setStatus('idle');
      setError('');
    }
  }, [isOpen, imageDataUrl]);

  const handleImageTranslation = async () => {
    if (!imageDataUrl) return;

    setStatus('loading');
    setError('');

    try {
      const newDataUrl = await editImageWithGemini(
        imageDataUrl,
        "이 이미지 안에 있는 모든 중국어 텍스트를 찾아서 자연스러운 한국어로 번역해줘. 그리고 원본 이미지의 배경, 폰트 스타일, 레이아웃을 최대한 유지하면서 중국어 글자들을 지우고 그 자리에 번역된 한국어 글자를 합성해서 새로운 이미지를 만들어줘. 결과물은 반드시 편집된 이미지여야 해."
      );
      setEditedImageDataUrl(newDataUrl);
      setStatus('success');
    } catch (err) {
      console.error("Image Translation Error:", err);
      setError("AI 이미지 편집 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setStatus('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[60] p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full p-6 sm:p-8 relative overflow-hidden flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors z-10" aria-label="Close modal">
          <CloseIcon />
        </button>

        <div className="flex items-center gap-2 mb-6">
          <SparklesIcon className="text-purple-400 w-6 h-6 animate-pulse" />
          <h2 className="text-2xl font-bold text-slate-100">AI 이미지 텍스트 번역 및 합성</h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 overflow-y-auto flex-grow">
          {/* Original Image */}
          <div className="lg:w-1/2 flex flex-col">
            <label className="text-xs font-bold text-slate-500 mb-2 uppercase">번역 전 (원본)</label>
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-2 flex items-center justify-center min-h-[300px] overflow-hidden">
               {imageDataUrl ? (
                 <img src={imageDataUrl} alt="Original" className="max-w-full max-h-[400px] object-contain rounded-lg" />
               ) : (
                 <p className="text-slate-500">이미지가 없습니다.</p>
               )}
            </div>
          </div>

          {/* Edited Image Result */}
          <div className="lg:w-1/2 flex flex-col">
            <label className="text-xs font-bold text-purple-400 mb-2 uppercase">번역 후 (AI 편집본)</label>
            <div className="bg-slate-900 rounded-xl border-2 border-purple-500/30 p-2 flex items-center justify-center min-h-[300px] relative overflow-hidden">
              {status === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-900/90 z-10">
                  <SpinnerIcon className="w-10 h-10 text-purple-500 animate-spin" />
                  <div className="text-center">
                    <p className="text-slate-200 font-bold">이미지 디자인 편집 중...</p>
                    <p className="text-xs text-slate-500 mt-1">중국어를 지우고 한국어를 합성하고 있습니다.</p>
                  </div>
                </div>
              )}
              {status === 'success' && editedImageDataUrl ? (
                <img src={editedImageDataUrl} alt="Translated" className="max-w-full max-h-[400px] object-contain rounded-lg shadow-2xl" />
              ) : status === 'error' ? (
                <div className="p-4 text-center">
                    <p className="text-red-400 mb-2">{error}</p>
                    <button onClick={handleImageTranslation} className="text-sm text-purple-400 hover:underline">다시 시도</button>
                </div>
              ) : (
                <div className="text-slate-600 italic">결과 대기 중...</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 pt-5 border-t border-slate-700">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-700 text-slate-300 font-semibold rounded-xl hover:bg-slate-600 transition-all">
            취소
          </button>
          <button 
            onClick={() => editedImageDataUrl && onSaveImage(editedImageDataUrl)}
            disabled={status !== 'success' || !editedImageDataUrl}
            className="flex items-center gap-2 px-8 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SaveIcon />
            이 이미지로 교체하기
          </button>
        </div>
      </div>
    </div>
  );
};

export default TranslationModal;
