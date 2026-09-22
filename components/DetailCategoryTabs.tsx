import React from 'react';
import { STANDALONE_DRAFT_ID } from './DetailPageBuilderModal';

// 상페작업 안의 카테고리 탭(김치, ...). 새 카테고리는 김치 틀을 그대로 복사해 시작하고,
// 작업 내용은 카테고리마다 따로 저장된다(draftIdForCategory).
export interface DetailCategory {
  id: string;
  name: string;
}

const CATEGORIES_KEY = 'detailPageCategories';
const ACTIVE_CATEGORY_KEY = 'detailPageActiveCategory';
export const KIMCHI_CATEGORY_ID = 'kimchi';
const DEFAULT_CATEGORIES: DetailCategory[] = [{ id: KIMCHI_CATEGORY_ID, name: '김치' }];

// 김치는 탭이 생기기 전부터 쓰던 저장 이름을 그대로 써야 예전 작업이 되살아난다.
export const draftIdForCategory = (id: string) =>
  id === KIMCHI_CATEGORY_ID ? STANDALONE_DRAFT_ID : `standalone-${id}`;

export const loadDetailCategories = (): DetailCategory[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || 'null');
    if (Array.isArray(saved) && saved.some(c => c && c.id === KIMCHI_CATEGORY_ID)) {
      return saved.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
    }
  } catch { /* 깨진 값이면 기본값으로 */ }
  return DEFAULT_CATEGORIES;
};

export const saveDetailCategories = (categories: DetailCategory[]) => {
  try { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories)); } catch { /* 저장 못 해도 이번 실행엔 지장 없음 */ }
};

export const loadActiveCategoryId = (categories: DetailCategory[]): string => {
  try {
    const id = localStorage.getItem(ACTIVE_CATEGORY_KEY);
    if (id && categories.some(c => c.id === id)) return id;
  } catch { /* 기본값으로 */ }
  return KIMCHI_CATEGORY_ID;
};

export const saveActiveCategoryId = (id: string) => {
  try { localStorage.setItem(ACTIVE_CATEGORY_KEY, id); } catch { /* 무시 */ }
};

interface DetailCategoryTabsProps {
  categories: DetailCategory[];
  // 상품 행에서 연 상세페이지면 그 상품 이름. 있으면 맨 앞에 그 탭이 선택된 채로 보인다.
  productTabLabel: string | null;
  activeCategoryId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

const tabClass = (active: boolean) =>
  `flex items-center gap-1.5 px-3.5 h-9 text-sm rounded-t-lg transition-colors whitespace-nowrap ${
    active ? 'bg-slate-900 text-slate-100 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
  }`;

const DetailCategoryTabs: React.FC<DetailCategoryTabsProps> = ({ categories, productTabLabel, activeCategoryId, onSelect, onAdd, onRemove }) => (
  <div className="flex items-end gap-1 px-4 pt-2 bg-slate-950 overflow-x-auto flex-shrink-0">
    {productTabLabel !== null && (
      <div className={tabClass(true)}>📦 {productTabLabel || '상품'}</div>
    )}
    {categories.map(category => {
      const active = productTabLabel === null && category.id === activeCategoryId;
      return (
        <div key={category.id} className={`${tabClass(active)} group cursor-pointer`} onClick={() => onSelect(category.id)}>
          <span>{category.name}</span>
          {category.id !== KIMCHI_CATEGORY_ID && (
            <button
              onClick={e => { e.stopPropagation(); onRemove(category.id); }}
              className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              title={`${category.name} 카테고리 삭제`}
              aria-label={`${category.name} 카테고리 삭제`}
            >
              ×
            </button>
          )}
        </div>
      );
    })}
    <button
      onClick={onAdd}
      className="flex items-center justify-center w-9 h-9 text-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-t-lg transition-colors"
      title="카테고리 추가 (김치 틀을 복사해서 시작)"
      aria-label="카테고리 추가"
    >
      +
    </button>
  </div>
);

export default DetailCategoryTabs;
