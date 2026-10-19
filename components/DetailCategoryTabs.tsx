import React from 'react';
import { STANDALONE_DRAFT_ID } from './DetailPageBuilderModal';

// 상페작업 안의 카테고리 탭(김치, ...). 새 카테고리는 김치 틀이나 초록 틀 중 하나로 시작하고,
// 작업 내용은 카테고리마다 따로 저장된다(draftIdForCategory).
// 한 카테고리 안에 상페를 여러 개 둘 수 있다(pages). 첫 상페는 예전 저장 이름을 그대로 쓴다.
export interface DetailPage {
  id: string;
  name: string;
  template?: 'kimchi' | 'green';
}

export interface DetailCategory {
  id: string;
  name: string;
  // 어느 틀로 시작했는지. 없으면 김치 틀(틀 고르기가 생기기 전에 만든 탭).
  template?: 'kimchi' | 'green';
  // 없으면 상페 하나뿐(MAIN_PAGE_ID, 틀은 위 template).
  pages?: DetailPage[];
  activePageId?: string;
}

export const MAIN_PAGE_ID = 'main';

export const getCategoryPages = (category: DetailCategory | undefined): DetailPage[] =>
  category?.pages?.length ? category.pages : [{ id: MAIN_PAGE_ID, name: '상페 1', template: category?.template }];

export const getActivePage = (category: DetailCategory | undefined): DetailPage => {
  const pages = getCategoryPages(category);
  return pages.find(p => p.id === category?.activePageId) ?? pages[0];
}

const CATEGORIES_KEY = 'detailPageCategories';
const ACTIVE_CATEGORY_KEY = 'detailPageActiveCategory';
export const KIMCHI_CATEGORY_ID = 'kimchi';
const DEFAULT_CATEGORIES: DetailCategory[] = [{ id: KIMCHI_CATEGORY_ID, name: '김치' }];

// 김치는 탭이 생기기 전부터 쓰던 저장 이름을 그대로 써야 예전 작업이 되살아난다.
// 초록 틀 작업은 이름 끝에 '-green'을 붙여 따로 둔다 — 한 탭에서 틀을 바꿔 봐도 서로 덮지 않는다.
export const draftIdForCategory = (id: string, template: DetailCategory['template'] = 'kimchi') => {
  const base = id === KIMCHI_CATEGORY_ID ? STANDALONE_DRAFT_ID : `standalone-${id}`;
  return template === 'green' ? `${base}-green` : base;
};

// 첫 상페(MAIN_PAGE_ID)는 카테고리 저장 이름 그대로, 추가한 상페는 '~상페id'를 붙여 따로 둔다.
export const draftIdForPage = (categoryId: string, pageId: string, template: DetailCategory['template'] = 'kimchi') => {
  if (pageId === MAIN_PAGE_ID) return draftIdForCategory(categoryId, template);
  const base = `${draftIdForCategory(categoryId)}~${pageId}`;
  return template === 'green' ? `${base}-green` : base;
};

// 저장 이름에서 카테고리·상페를 거꾸로 찾는다(중간저장 목록에 어디서 저장했는지 보여줄 때).
export const describeDraftOwner = (draftId: string) => {
  const green = draftId.endsWith('-green');
  const rest = green ? draftId.slice(0, -'-green'.length) : draftId;
  const [base, pageId = MAIN_PAGE_ID] = rest.split('~');
  const categoryId = base === STANDALONE_DRAFT_ID ? KIMCHI_CATEGORY_ID : base.replace(/^standalone-/, '');
  const category = loadDetailCategories().find(c => c.id === categoryId);
  const pages = getCategoryPages(category);
  const pageName = pages.length > 1 || pageId !== MAIN_PAGE_ID ? pages.find(p => p.id === pageId)?.name ?? '지운 상페' : null;
  return { categoryName: category?.name ?? '지운 탭', pageName, green };
};

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
  onRename: (id: string) => void;
  // 지금 카테고리 안의 상페들.
  pages: DetailPage[];
  activePageId: string;
  onSelectPage: (id: string) => void;
  onAddPage: () => void;
  onRenamePage: (id: string) => void;
  onRemovePage: (id: string) => void;
  onMovePage: (id: string) => void;
  onCopyPage: (id: string) => void;
}

const tabClass = (active: boolean) =>
  `flex items-center gap-1.5 px-3.5 h-9 text-sm rounded-t-lg transition-colors whitespace-nowrap ${
    active ? 'bg-slate-900 text-slate-100 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
  }`;

const pageClass = (active: boolean) =>
  `flex items-center gap-1 px-2.5 h-7 text-xs rounded-md transition-colors whitespace-nowrap ${
    active ? 'bg-slate-700 text-slate-100 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
  }`;

const DetailCategoryTabs: React.FC<DetailCategoryTabsProps> = ({ categories, productTabLabel, activeCategoryId, onSelect, onAdd, onRemove, onRename, pages, activePageId, onSelectPage, onAddPage, onRenamePage, onRemovePage, onMovePage, onCopyPage }) => (
  <div className="flex flex-col flex-shrink-0">
  <div className="flex items-end gap-1 px-4 pt-2 bg-slate-950 overflow-x-auto">
    {productTabLabel !== null && (
      <div className={tabClass(true)}>📦 {productTabLabel || '상품'}</div>
    )}
    {categories.map(category => {
      const active = productTabLabel === null && category.id === activeCategoryId;
      return (
        <div key={category.id} className={`${tabClass(active)} group cursor-pointer`} onClick={() => onSelect(category.id)} onDoubleClick={() => onRename(category.id)} title="두 번 누르면 이름 바꾸기">
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
      title="카테고리 추가 (김치 틀 / 초록 체크포인트 틀 중 골라서 시작)"
      aria-label="카테고리 추가"
    >
      +
    </button>
  </div>
  {productTabLabel === null && (
    <div className="flex items-center gap-1 px-4 py-1 bg-slate-900 border-b border-slate-800 overflow-x-auto">
      {pages.map(page => (
        <div
          key={page.id}
          className={`${pageClass(page.id === activePageId)} group cursor-pointer`}
          onClick={() => onSelectPage(page.id)}
          onDoubleClick={() => onRenamePage(page.id)}
          title="두 번 누르면 이름 바꾸기"
        >
          <span>{page.name}</span>
          <button
            onClick={e => { e.stopPropagation(); onCopyPage(page.id); }}
            className="text-slate-500 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title={`${page.name}을(를) 똑같이 복사해서 상페 하나 더 만들기`}
            aria-label={`${page.name} 복사`}
          >
            ⧉
          </button>
          {categories.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); onMovePage(page.id); }}
              className="text-slate-500 hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity"
              title={`${page.name}을(를) 다른 카테고리로 옮기기`}
              aria-label={`${page.name} 다른 카테고리로 옮기기`}
            >
              ⇄
            </button>
          )}
          {pages.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); onRemovePage(page.id); }}
              className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              title={`${page.name} 삭제`}
              aria-label={`${page.name} 삭제`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAddPage}
        className="px-2 h-7 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
        title="이 카테고리에 상페 하나 더 만들기"
      >
        + 상페
      </button>
    </div>
  )}
  </div>
);

export default DetailCategoryTabs;
