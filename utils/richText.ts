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
