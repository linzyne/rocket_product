import { useEffect, useState } from 'react';

// 메뉴의 요청목록 배지: 서허 요청 관리(업체 응답 필요·처리중)에 요청자가 WMS인 요청 중 아직 안 열어 본 수.
// 서허 연동 확장(app-bridge.js)이 받아 온다. 앱을 열 때와 탭으로 돌아올 때만 묻고, 바뀌면 확장이 알려 준다.
// filter는 메뉴를 누르면 열 서허 목록(업체 응답 필요에 있으면 그쪽, 아니면 처리중).
export const WMS_TICKET_PAGE = 'https://supplier.coupang.com/plan/ticket/issueManagement?filter=';

export const useWmsTickets = () => {
  const [state, setState] = useState<{ count: number; filter: string }>({ count: 0, filter: 'AWAITING' });
  useEffect(() => {
    const ask = () => window.postMessage({ source: 'rocket-app-hub', type: 'WMS_TICKETS_GET' }, window.location.origin);
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || !d || d.source !== 'rocket-hub-extension' || d.type !== 'WMS_TICKETS') return;
      setState({ count: Number(d.count) || 0, filter: d.filter === 'NEED_RESPONSE' ? 'NEED_RESPONSE' : 'AWAITING' });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') ask(); };
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisible);
    ask();
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return state;
};
