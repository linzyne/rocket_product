import React from 'react';

// 앱의 큰 메뉴. 주소창 해시(#/detail 등)에 그대로 쓰여서 새로고침해도 같은 메뉴가 열린다.
export type AppMenuId =
  | 'proposal'
  | 'detail'
  | 'coupang-order'
  | 'coupang-ship'
  | 'cn-order'
  | 'import-in'
  | 'shipment-out'
  | 'warehouse-in'
  | 'product-manage'
  | 'sales';

interface MenuItem {
  id: AppMenuId;
  label: string;
  icon: React.ReactNode;
  ready: boolean;
}

const icon = (d: string) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

// 업무 흐름 순서대로 묶는다. ready가 false인 메뉴는 아직 화면이 없어 "준비중"을 보여준다.
export const MENU_GROUPS: { title: string; items: MenuItem[] }[] = [
  {
    title: '상품',
    items: [
      { id: 'proposal', label: '로켓제안서', ready: true, icon: icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z') },
      { id: 'detail', label: '상페작업', ready: true, icon: icon('M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z') },
    ],
  },
  {
    title: '발주',
    items: [
      { id: 'coupang-order', label: '쿠팡발주확인', ready: true, icon: icon('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4') },
      { id: 'coupang-ship', label: '쉽먼트생성', ready: true, icon: icon('M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0') },
      { id: 'cn-order', label: '한중발주', ready: true, icon: icon('M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z') },
    ],
  },
  {
    title: '물류',
    items: [
      { id: 'import-in', label: '수입입고', ready: true, icon: icon('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4') },
      { id: 'shipment-out', label: '쉽먼트출고', ready: false, icon: icon('M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0') },
      { id: 'warehouse-in', label: '물류창고입고', ready: true, icon: icon('M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10') },
    ],
  },
  {
    title: '재고',
    items: [
      { id: 'product-manage', label: '상품관리', ready: true, icon: icon('M4 6h16M4 10h16M4 14h16M4 18h16') },
    ],
  },
  {
    title: '판매',
    items: [
      { id: 'sales', label: '판매량/재고', ready: true, icon: icon('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z') },
    ],
  },
];

const ALL_ITEMS = MENU_GROUPS.flatMap(g => g.items);

export const isAppMenuId = (value: string): value is AppMenuId => ALL_ITEMS.some(item => item.id === value);

export const menuLabel = (id: AppMenuId) => ALL_ITEMS.find(item => item.id === id)?.label ?? '';

interface AppSidebarProps {
  active: AppMenuId;
  onSelect: (id: AppMenuId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ active, onSelect, collapsed, onToggleCollapsed }) => (
  <nav className={`sticky top-0 h-screen flex-shrink-0 flex flex-col bg-white border-r border-gray-200 transition-[width] duration-150 ${collapsed ? 'w-14' : 'w-44'}`}>
    <div className={`flex items-center h-12 border-b border-gray-100 ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
      {!collapsed && <span className="text-base font-bold text-gray-900">🚀 로켓</span>}
      <button
        onClick={onToggleCollapsed}
        className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        title={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
        aria-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
      >
        {icon(collapsed ? 'M13 5l7 7-7 7M5 5l7 7-7 7' : 'M11 19l-7-7 7-7m8 14l-7-7 7-7')}
      </button>
    </div>
    <div className="flex-1 overflow-y-auto py-2">
      {MENU_GROUPS.map(group => (
        <div key={group.title} className="mb-2">
          {collapsed
            ? <div className="mx-3 my-2 border-t border-gray-100" />
            : <div className="px-4 pt-2 pb-1 text-[11px] font-semibold text-gray-400">{group.title}</div>}
          {group.items.map(item => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-2.5 text-sm transition-colors ${collapsed ? 'justify-center py-2' : 'px-4 py-1.5'} ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : item.ready
                      ? 'text-gray-700 hover:bg-gray-50'
                      : 'text-gray-400 hover:bg-gray-50'
                }`}
              >
                {item.icon}
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  </nav>
);

export const MenuPlaceholder: React.FC<{ id: AppMenuId }> = ({ id }) => (
  <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-gray-400 gap-1">
    <div className="text-lg font-semibold text-gray-600">{menuLabel(id)}</div>
    <div className="text-sm">준비중인 메뉴입니다.</div>
  </div>
);

export default AppSidebar;
