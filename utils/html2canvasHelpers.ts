// html2canvas clones the document into a hidden iframe to capture it, which copies every <script>
// tag in <head> along with it (the CDN tags for tailwind, xlsx, exceljs, jszip, html2canvas itself).
// None of those are needed to render static markup inside the capture iframe, so drop them from the
// clone as a precaution against them being re-fetched/re-run there.
export const stripClonedScripts = (clonedDoc: Document) => {
  clonedDoc.querySelectorAll('script').forEach(el => el.remove());
};

// html2canvas has no built-in timeout for the overall capture — only per-resource (`imageTimeout`).
// If a single network hiccup ever leaves it hanging, the caller's `finally` never runs and the
// download button gets stuck "busy" forever (every later click on it silently no-ops). Race it
// against a hard timeout so the button always recovers, even if this particular capture fails.
export const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);

// 미리보기에서는 아직 안 채운 섹션도 자리를 보여줘야 클릭해서 타이핑할 수 있다. 하지만 저장
// 이미지에는 그 빈 자리가 들어가면 안 되므로, 캡처용 사본에서만 통째로 걷어낸다
// (KimchiDetailSections가 data-empty-section 표시를 달아둔다).
export const stripEmptySections = (clonedDoc: Document) => {
  clonedDoc.querySelectorAll('[data-empty-section="true"]').forEach(el => el.remove());
};
