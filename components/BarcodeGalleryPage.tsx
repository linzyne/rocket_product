import React, { useEffect, useMemo, useState } from 'react';
import { ArchivedProduct } from '../types';
import { SearchIcon } from './Icons';
import { writeBarcodeSheet } from '../utils/barcodeSheet';
import { loadBarcodeBook } from '../data/coupangBarcodeStore';
import { subscribeBarcodePhotos, setBarcodePhoto } from '../data/barcodePhotoStore';
import { resizeImageDataUrl } from '../utils/imageResize';

// 상품목록에 저장된 상품을 썸네일로 늘어놓고, 누르면 그 상품 바코드 라벨(폼텍 40칸)을 새 탭에 연다.
// 장수·용지·위치는 새 탭 도구줄에서 고르고 인쇄한다.
// 쿠팡 바코드 장부(쉽먼트 라벨에 쓰는 것)에만 있는 상품도 뒤에 붙인다.
// 사진 없는 칸은 눌러서 사진을 올리면 바코드별로 저장해 두고 계속 보여 준다.
type Item = { key: string; name: string; barcode: string; thumb?: string };

interface BarcodeGalleryPageProps {
  entries: ArchivedProduct[];
}

const BarcodeGalleryPage: React.FC<BarcodeGalleryPageProps> = ({ entries }) => {
  const [query, setQuery] = useState('');
  const [bookByName, setBookByName] = useState<Record<string, string>>({});

  const [photos, setPhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    loadBarcodeBook().then(book => setBookByName(book.byName));
  }, []);
  useEffect(() => subscribeBarcodePhotos(setPhotos), []);

  // 바코드 있는 것만, 같은 바코드는 하나만(상품목록의 최근 저장한 것 먼저).
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: Item[] = [];
    const add = (it: Item) => {
      const bc = it.barcode.trim();
      if (!bc || seen.has(bc)) return;
      seen.add(bc);
      all.push({ ...it, barcode: bc, thumb: it.thumb || photos[bc] });
    };
    [...entries]
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
      .forEach(e => add({ key: e.id, name: e.productName, barcode: e.barcode || '', thumb: e.thumbnailDataUrl }));
    Object.entries(bookByName).forEach(([name, bc]) => add({ key: `book:${name}`, name, barcode: String(bc) }));
    const q = query.trim().toLowerCase();
    return q ? all.filter(e => e.name.toLowerCase().includes(q) || e.barcode.includes(q)) : all;
  }, [entries, bookByName, photos, query]);

  const uploadPhoto = (e: Item, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setBarcodePhoto(e.barcode, await resizeImageDataUrl(String(reader.result)));
      } catch (err) {
        alert('사진을 읽지 못했어요.');
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  };

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
            <div
              key={e.key}
              className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition"
            >
              {e.thumb ? (
                <button onClick={() => print(e)} title={`${e.name}\n${e.barcode} — 눌러서 바코드 인쇄`} className="block w-full aspect-square bg-gray-100">
                  <img src={e.thumb} alt="" className="w-full h-full object-cover" />
                </button>
              ) : (
                <label className="w-full aspect-square bg-gray-100 flex flex-col items-center justify-center gap-1 cursor-pointer text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-xs">사진 등록</span>
                  <input type="file" accept="image/*" className="hidden" onChange={ev => { uploadPhoto(e, ev.target.files?.[0]); ev.target.value = ''; }} />
                </label>
              )}
              <button onClick={() => print(e)} title={`${e.name}\n${e.barcode} — 눌러서 바코드 인쇄`} className="block w-full text-left p-1.5">
                <p className="text-xs font-medium leading-tight line-clamp-2 group-hover:text-blue-600">{e.name || '-'}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">{e.barcode}</p>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BarcodeGalleryPage;
