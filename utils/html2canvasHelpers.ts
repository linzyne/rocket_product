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
//
// 단, 섹션이 하나도 남지 않게 되는 경우에는 걷어내지 않는다 — 그러면 캡처가 통째로 백지가 되어
// 흰 이미지가 저장돼 나간다. 아직 아무것도 안 채운 페이지라면 채운 그대로(=빈 자리 표시까지)
// 나오는 편이 "왜 흰색이지" 하는 것보다 낫다.
export const stripEmptySections = (clonedDoc: Document) => {
  const all = clonedDoc.querySelectorAll('[data-section-id]');
  const empty = clonedDoc.querySelectorAll('[data-empty-section="true"]');
  if (all.length > 0 && empty.length >= all.length) return;
  empty.forEach(el => el.remove());
};

// Tailwind의 preflight(index.html의 CDN 스크립트가 넣는다)는 `img { display: block }`을 건다.
// 그런데 html2canvas는 글자를 어느 높이에 그릴지 정할 때, 1×1짜리 이미지를 글자 옆에 놓고
// `vertical-align: baseline`으로 세운 뒤 그 이미지의 위치로 baseline을 읽는다
// (FontMetrics.parseMetrics). img가 block이면 그 이미지가 글자와 같은 줄에 서지 못하고 다음 줄로
// 떨어져서, baseline이 "글자 윗선에서 baseline까지"가 아니라 "줄 하나의 높이"로 잡힌다.
// 글자는 딱 그 차이만큼 아래로 내려 그려진다 — 40px 배지 글자에서 17px이나 처지는 바람에,
// 화면에서는 테두리 한가운데 있던 문구가 저장 이미지에서만 아래로 쏠려 보였다.
//
// 그래서 캡처하는 동안만 그 측정용 이미지에 display:inline을 돌려준다. 가로·세로가 둘 다 1인
// img는 앱 어디에도 없으니(사진은 전부 그보다 크다) 화면에 나가는 그림에는 영향이 없고,
// 캡처가 끝나면 규칙을 걷어낸다. html2canvas는 baseline을 원본 문서에서 재므로(new
// FontMetrics(document)) 사본이 아니라 이쪽에 걸어야 한다.
export const withInlineImageMetrics = async <T,>(run: () => Promise<T>): Promise<T> => {
  const style = document.createElement('style');
  style.textContent = 'img[width="1"][height="1"]{display:inline!important}';
  document.head.appendChild(style);
  try {
    return await run();
  } finally {
    style.remove();
  }
};
