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
