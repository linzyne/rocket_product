import { openAppDb } from '../data/appDb';
// Shared save-as helpers for image downloads across the app.
//
// saveBlobInProductFolder / saveDataUrlInProductFolder (Chrome/Edge): the user picks a base folder
// once per session (cached in `cachedRootDir`); every save after that auto-creates/reuses a
// subfolder named after the product (its 상세이미지 filename, see `productFolderName`) and drops
// the file in there — no repeated folder prompts per product.
//
// saveBlob / saveDataUrl: single-file "save as" picker, used as the fallback when the directory
// picker API isn't available, and directly by callers that don't have a product/folder concept.
// Loaded globally via CDN script tag in index.html (same pattern as data/quoteTemplates.ts).
declare var JSZip: any;

let cachedRootDir: any = null;

function sanitizeFolderName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'product';
}

// Lets the user type/edit the actual file name before saving, defaulting to `defaultName`.
// Returns null if the user cancels the prompt (caller should abort the save).
function promptFileName(defaultName: string): string | null {
  const input = window.prompt('저장할 파일명을 입력하세요', defaultName);
  if (input === null) return null;
  const trimmed = input.trim();
  if (!trimmed) return defaultName;
  const extIdx = defaultName.lastIndexOf('.');
  const extension = extIdx >= 0 ? defaultName.slice(extIdx) : '';
  return extension && !trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? `${trimmed}${extension}` : trimmed;
}

// Prefer the product's 상세이미지 (detail image) filename as the folder name; fall back to the
// product name, then a generic label, so every download always lands in *some* per-product folder.
export function productFolderName(product: { detailFile?: string; productName?: string } | null | undefined): string {
  return sanitizeFolderName(product?.detailFile || product?.productName || 'product');
}

// 상세페이지가 여러 장으로 잘려 저장될 때의 파일명. 한 장이면 기존 이름을 그대로 쓰고, 여러
// 장이면 뒤에 _01, _02… 를 붙인다. 확장자는 실제 데이터에 맞춘다 — 용량 때문에 JPEG로 대체됐는데
// 이름만 .png로 남으면 마켓 업로드에서 문제가 될 수 있다.
export function detailSliceFileNames(baseName: string, dataUrls: string[]): string[] {
  const dotIdx = baseName.lastIndexOf('.');
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const extension = dataUrls[0]?.startsWith('data:image/jpeg') ? '.jpg' : '.png';
  if (dataUrls.length <= 1) return [`${stem}${extension}`];
  return dataUrls.map((_, idx) => `${stem}_${String(idx + 1).padStart(2, '0')}${extension}`);
}

// Always uses the product name itself as the folder name (no detailFile fallback-first), for
// features like 통합다운 where the folder must match the product name exactly.
export function productNameFolderName(product: { productName?: string } | null | undefined): string {
  return sanitizeFolderName(product?.productName || 'product');
}

// Exported so callers can request/refresh folder-access permission immediately on click, before
// doing slow async work (image capture, zip building, xlsx generation) — the File System Access
// API requires "user activation" that a multi-step async chain would otherwise burn through by the
// time saveFilesInProductFolder gets around to calling this internally.

// 고른 폴더(디렉터리 핸들)를 IndexedDB에 저장해 둡니다. 핸들은 새로고침해도 살아남으므로,
// 다음부터는 폴더를 다시 고르지 않아도 되고 권한 창도 뜨지 않습니다(브라우저가 허용을 기억).
// 브라우저를 완전히 껐다 켠 뒤에는 권한이 'prompt'로 돌아가, 클릭 직후 한 번 확인만 받으면 됩니다.
const HANDLE_STORE = 'fileHandles';
const HANDLE_KEY = 'integratedDownloadRoot';

// DB 열기는 data/appDb.ts 한 곳에서만 한다(버전이 어긋나 열리지 않는 사고를 막는다).
const openHandleDb = async (): Promise<IDBDatabase | null> => {
  try {
    return await openAppDb();
  } catch (err) {
    console.log('[통합다운] 폴더 기억용 DB를 열지 못했습니다:', err);
    return null;
  }
};

const loadSavedRootDir = async (): Promise<any | null> => {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
};

const saveRootDir = async (handle: any): Promise<void> => {
  const db = await openHandleDb();
  if (!db) return;
  try {
    db.transaction(HANDLE_STORE, 'readwrite').objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
  } catch (err) {
    console.log('[통합다운] 폴더 기억 실패:', err);
  }
};

export async function getRootDirectory(): Promise<any | null> {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') {
    console.log('[통합다운] showDirectoryPicker 미지원 브라우저');
    return null;
  }

  // 이 세션에서 아직 고른 적이 없으면, 지난번에 기억해둔 폴더를 먼저 꺼내 씁니다.
  if (!cachedRootDir) cachedRootDir = await loadSavedRootDir();

  if (cachedRootDir) {
    try {
      const perm =
        (await cachedRootDir.queryPermission?.({ mode: 'readwrite' })) === 'granted'
          ? 'granted'
          : await cachedRootDir.requestPermission?.({ mode: 'readwrite' });
      console.log('[통합다운] 캐시된 폴더 권한 상태:', perm);
      if (perm === 'granted') return cachedRootDir;
    } catch (err) {
      console.log('[통합다운] 캐시된 폴더 권한 확인 중 예외:', err);
      // fall through to re-prompt below
    }
    cachedRootDir = null;
  }

  try {
    cachedRootDir = await picker({ mode: 'readwrite' });
    console.log('[통합다운] 새 폴더 선택 완료:', cachedRootDir?.name);
    await saveRootDir(cachedRootDir);
    return cachedRootDir;
  } catch (err: any) {
    if (err?.name !== 'AbortError') console.error('폴더 선택 실패:', err);
    else console.log('[통합다운] 폴더 선택 취소(AbortError)');
    return null;
  }
}

export async function saveBlob(blob: Blob, suggestedName: string, mimeType: string): Promise<void> {
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const extension = suggestedName.split('.').pop() || '';
      const handle = await picker({
        suggestedName,
        types: [{ description: '이미지 파일', accept: { [mimeType]: [`.${extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled the picker
      console.error('파일 저장 실패:', err);
      // fall through to the default download behavior below
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

export async function saveDataUrl(dataUrl: string, suggestedName: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  await saveBlob(blob, suggestedName, blob.type || 'image/png');
}

// Saves into <chosen root folder>/<folderName>/<fileName>, creating the subfolder if needed.
// Falls back to the single-file save picker (saveBlob) if the directory picker API is unavailable
// or the user/browser can't complete it.
export async function saveBlobInProductFolder(
  blob: Blob,
  folderName: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  const finalName = promptFileName(fileName);
  if (finalName === null) return; // user cancelled the filename prompt

  const root = await getRootDirectory();
  if (root) {
    try {
      const subDir = await root.getDirectoryHandle(sanitizeFolderName(folderName), { create: true });
      const fileHandle = await subDir.getFileHandle(finalName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('폴더에 파일 저장 실패:', err);
      // fall through to the fallback below
    }
  }
  await saveBlob(blob, finalName, mimeType);
}

export async function saveDataUrlInProductFolder(dataUrl: string, folderName: string, fileName: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  await saveBlobInProductFolder(blob, folderName, fileName, blob.type || 'image/png');
}

export async function buildZipBlob(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

// Bundles multiple data URLs (e.g. 대표/상세 이미지) into a single .zip and saves it via the same
// product-folder flow as the single-file helpers above.
export async function saveDataUrlsAsZipInProductFolder(
  files: { name: string; dataUrl: string }[],
  folderName: string,
  zipFileName: string
): Promise<void> {
  const blobs = await Promise.all(
    files.map(async file => ({ name: file.name, blob: await (await fetch(file.dataUrl)).blob() }))
  );
  const content = await buildZipBlob(blobs);
  await saveBlobInProductFolder(content, folderName, zipFileName, 'application/zip');
}

// Saves several already-distinct files (e.g. 라벨 + 이미지 zip + 견적서) into
// <chosen root folder>/<folderName>/ in one shot, without a per-file rename prompt — used by
// batch actions like 통합다운 where prompting per file would be tedious.
//
// Falls back to a single zip download (Safari/Firefox, where showDirectoryPicker doesn't exist):
// individual "save as" downloads land flat in the Downloads folder with no way to group them, so
// instead all files are bundled into one <folderName>.zip with each entry prefixed by
// <folderName>/ — extracting it reproduces the same product-named folder.
export async function saveFilesInProductFolder(
  folderName: string,
  files: { name: string; blob: Blob }[]
): Promise<void> {
  const safeFolderName = sanitizeFolderName(folderName);
  const root = await getRootDirectory();
  console.log('[통합다운] saveFilesInProductFolder: root =', root ? root.name : null, 'fileCount =', files.length);
  if (root) {
    try {
      const subDir = await root.getDirectoryHandle(safeFolderName, { create: true });
      for (const file of files) {
        const fileHandle = await subDir.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.blob);
        await writable.close();
        console.log('[통합다운] 파일 저장됨:', `${safeFolderName}/${file.name}`);
      }
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') { console.log('[통합다운] 저장 중 AbortError'); return; }
      console.error('폴더에 파일 저장 실패:', err);
      // fall through to the fallback below
    }
  }
  console.log('[통합다운] fallback zip 다운로드 경로 진입');
  const prefixedFiles = files.map(file => ({ name: `${safeFolderName}/${file.name}`, blob: file.blob }));
  const zipBlob = await buildZipBlob(prefixedFiles);
  await saveBlob(zipBlob, `${safeFolderName}.zip`, 'application/zip');
}
