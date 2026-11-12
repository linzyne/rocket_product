import React, { useEffect, useMemo, useState } from 'react';
import { ArchivedProduct } from '../types';
import { SearchIcon } from './Icons';
import { writeBarcodeSheet } from '../utils/barcodeSheet';
import { loadBarcodeBook } from '../data/coupangBarcodeStore';
import { subscribeBarcodeExtras, setBarcodePhoto, addBarcodeItem, setBarcodeTitle, BarcodeExtra } from '../data/barcodePhotoStore';
import { generateBarcodeNumber } from '../utils/barcode';
import { resizeImageDataUrl } from '../utils/imageResize';

// 상품목록에 저장된 상품을 썸네일로 늘어놓고, 누르면 그 상품 바코드 라벨(폼텍 40칸)을 새 탭에 연다.
// 장수·용지·위치는 새 탭 도구줄에서 고르고 인쇄한다.
// 쿠팡 바코드 장부(쉽먼트 라벨에 쓰는 것)에만 있는 상품도 뒤에 붙인다.
// 사진 없는 칸은 눌러서 사진을 올리면 바코드별로 저장해 두고 계속 보여 준다.
// 어디에도 없는 상품은 맨 앞 칸에서 이름을 적어 바코드를 새로 만든다(번호를 적으면 그 번호로).
type Item = { key: string; name: string; barcode: string; thumb?: string };

interface BarcodeGalleryPageProps {
  entries: ArchivedProduct[];
}

const BarcodeGalleryPage: React.FC<BarcodeGalleryPageProps> = ({ entries }) => {
  const [query, setQuery] = useState('');
  const [bookByName, setBookByName] = useState<Record<string, string>>({});

  const [extras, setExtras] = useState<Record<string, BarcodeExtra>>({});
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  // 상품명 고치는 중인 칸(바코드)과 적는 중인 이름.
  const [editing, setEditing] = useState('');
  const [editText, setEditText] = useState('');

  useEffect(() => {
    loadBarcodeBook().then(book => setBookByName(book.byName));
  }, []);
  useEffect(() => subscribeBarcodeExtras(setExtras), []);

  // 바코드 있는 것만, 같은 바코드는 하나만(상품목록의 최근 저장한 것 먼저).
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: Item[] = [];
    const add = (it: Item) => {
      const bc = it.barcode.trim();
      if (!bc || seen.has(bc)) return;
      seen.add(bc);
      all.push({ ...it, barcode: bc, name: extras[bc]?.title || it.name, thumb: it.thumb || extras[bc]?.thumb });
    };
    // 직접 만든 것(최근 것 먼저)을 맨 앞에.
    (Object.values(extras) as BarcodeExtra[])
      .filter(x => x.name)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .forEach(x => add({ key: `own:${x.barcode}`, name: x.name || '', barcode: x.barcode }));
    [...entries]
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
      .forEach(e => add({ key: e.id, name: e.productName, barcode: e.barcode || '', thumb: e.thumbnailDataUrl }));
    Object.entries(bookByName).forEach(([name, bc]) => add({ key: `book:${name}`, name, barcode: String(bc) }));
    const q = query.trim().toLowerCase();
    return q ? all.filter(e => e.name.toLowerCase().includes(q) || e.barcode.includes(q)) : all;
  }, [entries, bookByName, extras, query]);

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    const code = newCode.trim() || generateBarcodeNumber();
    const same = items.find(it => it.barcode === code);
    if (same && !confirm(`이 바코드는 이미 "${same.name}"에 있어요. 그래도 만들까요?`)) return;
    addBarcodeItem(code, name);
    setNewName('');
    setNewCode('');
  };

  const saveTitle = (e: Item) => {
    const t = editText.trim();
    if (t && t !== e.name) setBarcodeTitle(e.barcode, t);
    setEditing('');
  };

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
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          <form
            onSubmit={ev => { ev.preventDefault(); create(); }}
            className="flex flex-col gap-1.5 p-2 bg-blue-50 border border-dashed border-blue-300 rounded-lg"
          >
            <p className="text-xs font-bold text-blue-700">새 바코드</p>
            <textarea
              value={newName}
              onChange={ev => setNewName(ev.target.value)}
              placeholder="상품명"
              rows={3}
              className="w-full flex-1 px-1.5 py-1 text-xs bg-white border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              value={newCode}
              onChange={ev => setNewCode(ev.target.value)}
              placeholder="번호(비우면 자동)"
              className="w-full px-1.5 py-1 text-[11px] bg-white border border-gray-300 rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button type="submit" disabled={!newName.trim()} className="py-1 text-xs font-bold text-white bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-40">
              만들기
            </button>
          </form>
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
              {editing === e.barcode ? (
                <div className="p-1.5">
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={ev => setEditText(ev.target.value)}
                    onBlur={() => saveTitle(e)}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) { ev.preventDefault(); saveTitle(e); }
                      if (ev.key === 'Escape') setEditing('');
                    }}
                    rows={2}
                    className="w-full px-1 py-0.5 text-xs border border-blue-400 rounded resize-none focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-400 tabular-nums">{e.barcode}</p>
                </div>
              ) : (
                <div className="relative">
                  <button onClick={() => print(e)} title={`${e.name}\n${e.barcode} — 눌러서 바코드 인쇄`} className="block w-full text-left p-1.5 pr-6">
                    <p className="text-xs font-medium leading-tight line-clamp-2 group-hover:text-blue-600">{e.name || '-'}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">{e.barcode}</p>
                  </button>
                  <button
                    onClick={() => { setEditing(e.barcode); setEditText(e.name); }}
                    title="상품명 고치기"
                    className="absolute top-1 right-1 px-1 text-xs text-gray-300 hover:text-blue-600"
                  >
                    ✎
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
    </div>
  );
};

export default BarcodeGalleryPage;
