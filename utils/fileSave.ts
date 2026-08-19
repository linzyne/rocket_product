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

// Always uses the product name itself as the folder name (no detailFile fallback-first), for
// features like 통합다운 where the folder must match the product name exactly.
export function productNameFolderName(product: { productName?: string } | null | undefined): string {
  return sanitizeFolderName(product?.productName || 'product');
}

// Exported so callers can request/refresh folder-access permission immediately on click, before
// doing slow async work (image capture, zip building, xlsx generation) — the File System Access
// API requires "user activation" that a multi-step async chain would otherwise burn through by the
// time saveFilesInProductFolder gets around to calling this internally.
export async function getRootDirectory(): Promise<any | null> {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') return null;

  if (cachedRootDir) {
    try {
      const perm =
        (await cachedRootDir.queryPermission?.({ mode: 'readwrite' })) === 'granted'
          ? 'granted'
          : await cachedRootDir.requestPermission?.({ mode: 'readwrite' });
      if (perm === 'granted') return cachedRootDir;
    } catch {
      // fall through to re-prompt below
    }
    cachedRootDir = null;
  }

  try {
    cachedRootDir = await picker({ mode: 'readwrite' });
    return cachedRootDir;
  } catch (err: any) {
    if (err?.name !== 'AbortError') console.error('폴더 선택 실패:', err);
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
  if (root) {
    try {
      const subDir = await root.getDirectoryHandle(safeFolderName, { create: true });
      for (const file of files) {
        const fileHandle = await subDir.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      }
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('폴더에 파일 저장 실패:', err);
      // fall through to the fallback below
    }
  }
  const prefixedFiles = files.map(file => ({ name: `${safeFolderName}/${file.name}`, blob: file.blob }));
  const zipBlob = await buildZipBlob(prefixedFiles);
  await saveBlob(zipBlob, `${safeFolderName}.zip`, 'application/zip');
}
