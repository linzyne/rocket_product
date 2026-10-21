// 미리보기의 문구 블록(EditableText)은 순수 텍스트가 아니라 간단한 HTML을 담는다 — 드래그로
// 고른 일부 글자에만 색/크기/굵기를 줄 수 있어야 하기 때문이다. 저장되는 값은 <span style="...">
// 정도만 섞인 짧은 HTML이고, html2canvas가 그대로 이미지로 구워낸다.
//
// 예전에 저장된 값은 태그가 없는 순수 텍스트다. 그대로 innerHTML에 넣으면 "<"나 "&"가 태그로
// 해석돼버리므로, 태그가 없어 보이는 값은 이스케이프해서 넣는다(toEditableHtml).

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 서식이 들어간 값인지 대충 가늠한다. 사용자가 직접 "<"를 입력한 순수 텍스트를 HTML로 오해할
// 수 있지만, 그 경우도 화면에는 원래 글자가 그대로 보이므로 실질적인 손해는 없다.
function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function toEditableHtml(value: string): string {
  return looksLikeHtml(value) ? value : escapeHtml(value);
}

// 태그를 걷어낸 실제 글자만 뽑는다. "내용이 비었는지" 판단하거나 파일명·검증에 쓸 때 필요하다.
export function richTextToPlain(value: string): string {
  if (!looksLikeHtml(value)) return value;
  const el = document.createElement('div');
  el.innerHTML = value;
  return el.innerText;
}

// 빈 블록 판정. contentEditable은 글자를 다 지워도 <br>이나 빈 <div>를 남기는 경우가 있어서,
// 단순히 문자열 길이만 보면 "비어 있는데 비어 있지 않다"고 나온다.
export function isRichTextBlank(value: string): boolean {
  return richTextToPlain(value).trim() === '';
}

// 툴바로 글자를 줄이면 그 글자만 <span style="font-size">로 작아지고, 칸 자체 글자 크기는 그대로다.
// 브라우저는 줄마다 칸 글자 크기만큼의 높이를 최소로 잡기 때문에(strut), 줄 전체를 작게 바꿔도
// 줄 사이는 원래 큰 글씨 간격 그대로 벌어져 보인다. 한 줄의 글자가 전부 크기 지정 span 안에
// 있으면 그 줄을 감싼 블록의 글자 크기도 같게 맞춰서 줄 높이가 실제 글자를 따르게 한다.
const FIT_ATTR = 'data-fit-size';
const BLOCK_TAGS = new Set(['DIV', 'P']);

function lineFontSize(nodes: Node[], stop: Node): string | null {
  let max = 0;
  let sawText = false;
  const visit = (n: Node): boolean => {
    if (n.nodeType === 3) {
      if (!(n.textContent || '').trim()) return true;
      sawText = true;
      for (let p = n.parentElement; p && p !== stop; p = p.parentElement) {
        if (p.hasAttribute(FIT_ATTR)) break;
        const px = parseFloat(p.style.fontSize);
        if (px) { max = Math.max(max, px); return true; }
      }
      return false;
    }
    return Array.from(n.childNodes).every(visit);
  };
  return nodes.every(visit) && sawText ? `${max}px` : null;
}

function fitBlock(block: HTMLElement) {
  const size = lineFontSize(Array.from(block.childNodes), block);
  if (size) {
    block.style.fontSize = size;
    block.setAttribute(FIT_ATTR, '');
  } else if (block.hasAttribute(FIT_ATTR)) {
    block.style.removeProperty('font-size');
    block.removeAttribute(FIT_ATTR);
  }
}

function fitContainer(container: HTMLElement, isRoot: boolean) {
  const kids = Array.from(container.childNodes);
  const hasBlock = kids.some(n => n.nodeType === 1 && BLOCK_TAGS.has((n as HTMLElement).tagName));
  if (!hasBlock) {
    // 칸 자체(root)는 스타일이 props에서 오므로 손대지 않고, 내용을 블록으로 한 번 감싼다.
    if (!isRoot) return fitBlock(container);
    if (!lineFontSize(kids, container)) return;
    const wrap = document.createElement('div');
    kids.forEach(n => wrap.appendChild(n));
    container.appendChild(wrap);
    return fitBlock(wrap);
  }
  // 블록 사이에 낀 글자 덩어리(보통 첫 줄)는 따로 한 줄로 보고 필요하면 블록으로 감싼다.
  let run: Node[] = [];
  const flush = (before: Node | null) => {
    if (run.length && lineFontSize(run, container)) {
      const wrap = document.createElement('div');
      container.insertBefore(wrap, before);
      run.forEach(n => wrap.appendChild(n));
      fitBlock(wrap);
    }
    run = [];
  };
  for (const n of kids) {
    if (n.nodeType === 1 && BLOCK_TAGS.has((n as HTMLElement).tagName)) {
      flush(n);
      fitContainer(n as HTMLElement, false);
    } else {
      run.push(n);
    }
  }
  flush(null);
}

export function fitLineHeightsToFontSize(editable: HTMLElement) {
  fitContainer(editable, true);
}
