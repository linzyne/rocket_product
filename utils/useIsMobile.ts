import { useEffect, useState } from 'react';

// 휴대폰처럼 좁은 화면인지. 인라인 스타일로 그린 화면은 Tailwind의 sm:/md:를 못 쓰니 이걸로 나눈다.
export const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
