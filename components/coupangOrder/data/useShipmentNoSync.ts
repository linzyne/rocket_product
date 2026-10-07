import { useEffect } from 'react';
import { applyShipmentNos } from './shipOutStore';

// 확장이 서허에서 찾아 준 발주서별 쉽먼트 번호를 출고 건에 적는다.
// 업로드가 끝날 때 오는 소식과, 화면을 열 때 지난 결과를 다시 물어 받은 것 모두 쓴다(앱이 닫혀 있던 사이에 끝났을 수 있다).
export function useShipmentNoSync() {
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || !d || d.source !== 'rocket-hub-extension' || d.type !== 'SHUB_UPLOAD_STATUS') return;
      if (d.byOrder && typeof d.byOrder === 'object') applyShipmentNos(d.byOrder as Record<string, string>);
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'rocket-app-hub', type: 'SHUB_UPLOAD_GET' }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, []);
}
