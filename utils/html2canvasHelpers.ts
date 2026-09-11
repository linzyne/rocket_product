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

// html2canvas는 글자를 그릴 때 "줄 상자의 맨 위 + baseline" 자리에 얹는데, 그 baseline을
// 잴 때는 line-height를 normal로 둔 임시 요소를 쓴다(FontMetrics.parseMetrics). 그래서 우리처럼
// line-height를 1.1~1.7로 촘촘히 잡아둔 곳에서는 실제 줄 상자와 baseline 기준이 어긋나,
// 저장 이미지에서만 글자가 줄 상자 안에서 아래로 내려앉는다 — 에디터에서는 배지 테두리 한가운데
// 있던 글자가 저장하면 아래로 밀려 찍히는 이유다.
//
// 밀리는 양은 (normal 줄높이 − 실제 줄높이) / 2 로 정확히 떨어지므로, 캡처용 사본에서만 그만큼
// 되올려 상쇄한다. position:relative 의 top은 주변 배치(테두리·여백·다음 줄 위치)를 전혀
// 건드리지 않으므로 글자만 제자리로 돌아간다.
//
// 부모에 되올림을 주면 그 안의 글자가 통째로 따라 올라가므로, 자식에는 "자기 몫 − 이미 따라온 몫"
// 만큼만 더 준다. 서식 <span>이 섞인 문구 블록에서도 어긋나지 않게 하기 위한 것이다.
const measureNormalLineHeight = (
  doc: Document,
  cache: Map<string, number>,
  fontFamily: string,
  fontSize: string,
  fontWeight: string,
): number => {
  const key = `${fontFamily}|${fontSize}|${fontWeight}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:-9999px;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0;line-height:normal;';
  probe.style.fontFamily = fontFamily;
  probe.style.fontSize = fontSize;
  probe.style.fontWeight = fontWeight;
  // 라틴 대문자/소문자와 한글을 함께 넣어야 폰트가 실제로 쓰는 줄 높이가 나온다.
  probe.textContent = 'Ag한글';
  doc.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  doc.body.removeChild(probe);
  cache.set(key, height);
  return height;
};

export const fixTextBaselineShift = (clonedDoc: Document) => {
  const win = clonedDoc.defaultView;
  if (!win || !clonedDoc.body) return;
  const cache = new Map<string, number>();

  const hasOwnText = (el: Element) =>
    Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim() !== '');

  const walk = (el: HTMLElement, inheritedShift: number) => {
    let shiftHere = inheritedShift;
    if (hasOwnText(el)) {
      const cs = win.getComputedStyle(el);
      // line-height가 normal이면 html2canvas의 기준과 이미 같다 — 건드릴 이유가 없다.
      const actual = parseFloat(cs.lineHeight);
      if (!Number.isNaN(actual) && actual > 0) {
        const normal = measureNormalLineHeight(clonedDoc, cache, cs.fontFamily, cs.fontSize, cs.fontWeight);
        const wanted = (normal - actual) / 2;
        const delta = wanted - inheritedShift;
        // 반 픽셀도 안 되는 차이까지 손대면 얻는 것 없이 DOM만 흔든다.
        if (Math.abs(delta) >= 0.5) {
          const isStatic = cs.position === 'static';
          const baseTop = isStatic ? 0 : parseFloat(cs.top) || 0;
          if (isStatic) el.style.position = 'relative';
          el.style.top = `${baseTop - delta}px`;
          shiftHere = wanted;
        }
      }
    }
    Array.from(el.children).forEach(child => walk(child as HTMLElement, shiftHere));
  };

  walk(clonedDoc.body, 0);
};
