import React, { useEffect, useMemo, useState } from 'react';
import { ArchivedProduct } from '../types';
import { SearchIcon } from './Icons';
import { writeBarcodeSheet } from '../utils/barcodeSheet';
import { loadBarcodeBook } from '../data/coupangBarcodeStore';

// 상품목록에 저장된 상품을 썸네일로 늘어놓고, 누르면 그 상품 바코드 라벨(폼텍 40칸)을 새 탭에 연다.
// 장수·용지·위치는 새 탭 도구줄에서 고르고 인쇄한다.
// 쿠팡 바코드 장부(쉽먼트 라벨에 쓰는 것)에만 있는 상품도 뒤에 붙인다(사진 없음).
type Item = { key: string; name: string; barcode: string; thumb?: string };

interface BarcodeGalleryPageProps {
  entries: ArchivedProduct[];
}

const BarcodeGalleryPage: React.FC<BarcodeGalleryPageProps> = ({ entries }) => {
  const [query, setQuery] = useState('');
  const [bookByName, setBookByName] = useState<Record<string, string>>({});

  useEffect(() => {
    loadBarcodeBook().then(book => setBookByName(book.byName));
  }, []);

  // 바코드 있는 것만, 같은 바코드는 하나만(상품목록의 최근 저장한 것 먼저).
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: Item[] = [];
    const add = (it: Item) => {
      const bc = it.barcode.trim();
      if (!bc || seen.has(bc)) return;
      seen.add(bc);
      all.push({ ...it, barcode: bc });
    };
    [...entries]
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
      .forEach(e => add({ key: e.id, name: e.productName, barcode: e.barcode || '', thumb: e.thumbnailDataUrl }));
    Object.entries(bookByName).forEach(([name, bc]) => add({ key: `book:${name}`, name, barcode: String(bc) }));
    const q = query.trim().toLowerCase();
    return q ? all.filter(e => e.name.toLowerCase().includes(q) || e.barcode.includes(q)) : all;
  }, [entries, bookByName, query]);

  const print = (e: Item) => {
    const win = window.open('', '_blank');
    if (!win) {
      alert('새 탭이 막혔어요. 팝업 허용 후 다시 눌러 주세요.');
      return;
    }
    writeBarcodeSheet(win, `${e.name} 바코드`, [{ name: e.name, barcode: e.barcode, qty: 0 }]);
  };

  return (
    <div className="w-full max-w-screen-2xl text-gray-900">
      <header className="flex items-center gap-2 mb-5">
        <h1 className="text-lg font-bold">바코드</h1>
        <span className="text-sm text-gray-500">{items.length}개</span>
        <div className="relative ml-auto w-56">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <SearchIcon />
          </span>
          <input
            type="text"
            placeholder="상품명·바코드"
            value={query}
            onChange={ev => setQuery(ev.target.value)}
            className="w-full pl-10 pr-3 py-1.5 bg-white border border-gray-300 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">바코드 있는 상품이 없어요.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {items.map(e => (
            <button
              key={e.key}
              onClick={() => print(e)}
              title={`${e.name}\n${e.barcode} — 눌러서 바코드 인쇄`}
              className="group text-left bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition"
            >
              <div className="aspect-square bg-gray-100 flex items-center justify-center">
                {e.thumb ? (
                  <img src={e.thumb} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-gray-400">사진 없음</span>
                )}
              </div>
              <div className="p-1.5">
                <p className="text-xs font-medium leading-tight line-clamp-2 group-hover:text-blue-600">{e.name || '-'}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">{e.barcode}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default BarcodeGalleryPage;
