// 앱 어디서든 발주번호(1로 시작하는 9자리 숫자, 예: 143580391)를 누르면 클립보드에 복사한다.
// 화면마다 따로 만들지 않고 문서 전체에서 한 번 듣는다: 누른 곳의 글자가 발주번호 하나뿐이면 복사하고
// 화면 아래에 잠깐 알림을 띄운다. 입력칸·선택칸에서 누른 것은 건드리지 않는다.
const ORDER_NO = /^1\d{8}$/;

const toast = (text: string) => {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3000;padding:8px 14px;border-radius:10px;' +
    'background:#1f2937;color:#fff;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.2);pointer-events:none;' +
    "font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;transition:opacity .2s";
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1100);
  setTimeout(() => el.remove(), 1400);
};

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
};

// 누른 곳에서 위로 몇 칸 올라가며 "글자가 발주번호 하나뿐인" 칸을 찾는다(글자 조각이 여러 겹으로 싸여 있을 수 있어서).
const orderNoAt = (target: EventTarget | null): string => {
  let el = target instanceof Element ? target : null;
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return '';
    const text = (el.textContent || '').trim();
    if (ORDER_NO.test(text)) return text;
    if (text.length > 12) return '';
  }
  return '';
};

export const installOrderNoCopy = (): (() => void) => {
  const onClick = (e: MouseEvent) => {
    // 글자를 끌어서 고르는 중이면 방해하지 않는다.
    if (String(window.getSelection() || '').length > 0) return;
    const no = orderNoAt(e.target);
    if (!no) return;
    copy(no).then(() => toast(`발주번호 ${no} 복사했어요`));
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
};
