
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, SpinnerIcon } from './Icons';
import { extractCategoryKeywords } from '../utils/categoryKeyword';
import { QuoteTemplateProfile, readCategoryDropdownOptions } from '../data/quoteTemplates';
import {
  cancelCategorySearch,
  dataUrlToFile,
  pickCategory,
  searchCategories,
  subscribeCategoryEvents,
  unwrapDownloadedQuote,
} from '../utils/rocketProposal';

interface CategoryQuoteFinderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 키워드를 뽑을 상품명. */
  productName: string;
  /** 받아온 견적서를 카테고리와 함께 등록합니다. */
  onDownloaded: (category: string, file: File) => void;
  /** 견적서 안의 카테고리 드롭다운 목록을 읽는 데 씁니다. */
  quoteTemplateProfile?: QuoteTemplateProfile;
}

type Phase = 'idle' | 'searching' | 'results' | 'downloading' | 'category';

// 확장을 새로 로드하면 이미 열려 있던 탭의 중계 스크립트가 죽은 확장을 가리켜서
// "Extension context invalidated"가 납니다. 원인이 뭔지 알기 어려운 문구라 바꿔 보여줍니다.
const toFriendlyError = (message?: string): string => {
  const text = String(message || '');
  if (/Extension context invalidated|Receiving end does not exist/i.test(text)) {
    return '확장이 새로 로드됐습니다. 이 페이지를 새로고침한 뒤 다시 시도해주세요.';
  }
  return text || '요청에 실패했습니다.';
};

// 검색은 서플라이어허브 화면을 실제로 조작해서 이뤄지므로, 키워드 하나로만 검색합니다.
// (문장을 통째로 넣으면 결과가 나오지 않습니다.)
const CategoryQuoteFinderModal: React.FC<CategoryQuoteFinderModalProps> = ({
  isOpen,
  onClose,
  productName,
  onDownloaded,
  quoteTemplateProfile,
}) => {
  const [keyword, setKeyword] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [items, setItems] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const pickedPathRef = useRef<string>('');
  const searchedKeywordRef = useRef<string>('');
  // 견적서 안의 카테고리 드롭다운 목록. 여러 개면 사용자가 골라야 한다.
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const words = extractCategoryKeywords(productName);
    setCandidates(words);
    setKeyword(words[0] || '');
    setItems([]);
    setError(null);
    setPhase('idle');
    setCategoryOptions([]);
    setPendingFile(null);
  }, [isOpen, productName]);

  useEffect(() => {
    if (!isOpen) return undefined;
    return subscribeCategoryEvents({
      onResults: (found) => {
        setItems(found);
        setPhase('results');
      },
      onFile: async ({ name, dataUrl, path }) => {
        // 카테고리 이름은 경로의 마지막 조각(예: "일반노트")을 씁니다.
        const category = (path || pickedPathRef.current).split('>').pop()?.trim() || '카테고리';
        // 파일 이름은 검색에 쓴 키워드로 둡니다(쿠팡이 주는 이름은 카테고리 구분이 안 됩니다).
        const base = searchedKeywordRef.current || category;
        const fileName = `${base}_견적서.xlsx`;
        void name;
        try {
          // zip으로 내려오면 그 안의 엑셀을 꺼내서 씁니다.
          const file = await unwrapDownloadedQuote(dataUrlToFile(dataUrl, fileName), fileName);

          // 견적서의 카테고리 칸은 드롭다운이라, 파일에 든 목록의 값을 그대로 넣어야 합니다.
          let options: string[] = [];
          if (quoteTemplateProfile) {
            try {
              const fileDataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
              });
              options = await readCategoryDropdownOptions(fileDataUrl, quoteTemplateProfile);
            } catch (err) {
              console.error('카테고리 목록을 읽지 못했습니다:', err);
            }
          }

          if (options.length > 1) {
            setPendingFile(file);
            setCategoryOptions(options);
            setPhase('category');
            return;
          }
          onDownloaded(options[0] || category, file);
          onClose();
        } catch (err) {
          setError(`받은 견적서를 여는 데 실패했습니다: ${err instanceof Error ? err.message : String(err)}`);
          setPhase('results');
        }
      },
      onError: (message) => {
        setError(toFriendlyError(message));
        setPhase(prev => (prev === 'downloading' ? 'results' : 'idle'));
      },
    });
  }, [isOpen, onClose, onDownloaded, quoteTemplateProfile]);

  const handleSearch = useCallback(async () => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    searchedKeywordRef.current = trimmed;
    setError(null);
    setItems([]);
    setPhase('searching');
    const result = await searchCategories(trimmed);
    if (!result.ok) {
      setError(result.noExtension ? '크롬 확장이 필요합니다. 확장을 설치·새로고침한 뒤 이 페이지를 새로고침해주세요.' : toFriendlyError(result.error));
      setPhase('idle');
    }
  }, [keyword]);

  const handlePick = useCallback(async (path: string) => {
    pickedPathRef.current = path;
    setError(null);
    setPhase('downloading');
    const result = await pickCategory(path);
    if (!result.ok) {
      setError(toFriendlyError(result.error));
      setPhase('results');
    }
  }, []);

  const handleClose = useCallback(() => {
    cancelCategorySearch();
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={handleClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 relative flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={handleClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">카테고리 견적서 찾기</h2>
        <p className="text-sm text-slate-400 mb-5">
          쿠팡 서플라이어허브에서 키워드로 카테고리를 검색하고, 고른 카테고리의 견적서 양식을 자동으로 받아 등록합니다.
          검색은 <span className="text-slate-200 font-medium">한 단어</span>로만 됩니다. (쿠팡 로그인 필요)
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="예: 노트"
            className="flex-grow px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={!keyword.trim() || phase === 'searching' || phase === 'downloading'}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-md flex items-center gap-2"
          >
            {phase === 'searching' ? <SpinnerIcon /> : null}
            검색
          </button>
        </div>

        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {candidates.map(word => (
              <button
                key={word}
                type="button"
                onClick={() => setKeyword(word)}
                className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                  keyword === word
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {word}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        {phase === 'searching' && <p className="text-sm text-slate-400">서플라이어허브에서 검색하는 중입니다...</p>}
        {phase === 'downloading' && <p className="text-sm text-amber-300">견적서를 받는 중입니다...</p>}

        {phase === 'category' && (
          <div className="overflow-y-auto flex-grow min-h-0 -mx-1 px-1">
            <p className="text-sm text-slate-300 mb-2">
              견적서에 넣을 카테고리를 고르세요. (견적서 드롭다운에 있는 값 그대로 들어갑니다)
            </p>
            {categoryOptions.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  if (!pendingFile) return;
                  onDownloaded(option, pendingFile);
                  onClose();
                }}
                className="w-full text-left px-3 py-2 mb-1.5 rounded-md bg-slate-700/60 hover:bg-blue-600 text-sm text-slate-200 hover:text-white transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-y-auto flex-grow min-h-0 -mx-1 px-1">
          {phase !== 'category' && items.map(path => (
            <button
              key={path}
              type="button"
              onClick={() => handlePick(path)}
              disabled={phase === 'downloading'}
              className="w-full text-left px-3 py-2 mb-1.5 rounded-md bg-slate-700/60 hover:bg-blue-600 text-sm text-slate-200 hover:text-white transition-colors disabled:opacity-50"
            >
              {path}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryQuoteFinderModal;
