// 서허 요청 관리(/plan/ticket/issueManagement)에 요청자가 WMS인 새 요청이 올라오면
// 왼쪽 위 "요청 목록" 버튼에 빨간 숫자를 띄운다.
//   - 업체 응답 필요·처리중 목록 중 요청자 WMS인 것(background.js가 받아 wmsTickets에 적음)에서 아직 안 열어 본 요청 수를 센다.
//   - 같은 숫자를 로켓 앱 왼쪽 메뉴 '요청목록'에도 띄운다(app-bridge.js).
//   - 목록에서 그 요청 줄을 누르면(열어 보면) 본 것으로 치고 숫자에서 뺀다. 그 줄 앞엔 빨간 점도 찍는다.
//   - 몇 초마다 묻지 않는다. 화면을 열 때와 탭으로 돌아올 때만 한 번 받아 온다.
(() => {
  if (window.__rocketTicketAlertInjected) return;
  window.__rocketTicketAlertInjected = true;
  if (window !== window.top) return;

  const SEEN_KEY = 'wmsTicketSeen';
  const TICKETS_KEY = 'wmsTickets';
  const BADGE_CLASS = 'rocket-wms-badge';
  const DOT_CLASS = 'rocket-wms-dot';

  let unseen = []; // 안 열어 본 WMS 요청 processId(문자열)

  const getSeen = () =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(SEEN_KEY, (r) => resolve((r && r[SEEN_KEY]) || null));
      } catch (err) {
        resolve(null);
      }
    });
  const setSeen = (ids) => {
    try {
      chrome.storage.local.set({ [SEEN_KEY]: ids });
    } catch (err) {}
  };

  const style = document.createElement('style');
  style.textContent = `
    .${BADGE_CLASS}{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;
      padding:0 5px;margin-left:6px;border-radius:9px;background:#e53935;color:#fff;font-size:11px;
      font-weight:700;line-height:1;box-sizing:border-box}
    .${DOT_CLASS}{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;
      background:#e53935;vertical-align:middle}
  `;
  (document.head || document.documentElement).appendChild(style);

  const findNavButton = () =>
    [...document.querySelectorAll('.ticket-workspace__nav-item')].find((b) =>
      b.textContent.replace(/\d+/g, '').replace(/\s+/g, '').includes('요청목록')
    );

  const paint = () => {
    const btn = findNavButton();
    if (btn) {
      let badge = btn.querySelector('.' + BADGE_CLASS);
      if (unseen.length) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = BADGE_CLASS;
          btn.appendChild(badge);
        }
        const text = String(unseen.length);
        if (badge.textContent !== text) badge.textContent = text;
        badge.title = `WMS 새 요청 ${unseen.length}건`;
      } else if (badge) {
        badge.remove();
      }
    }
    // 목록 줄 앞에 빨간 점
    document.querySelectorAll('tr').forEach((tr) => {
      const cell = tr.querySelector('td');
      if (!cell) return;
      const id = (cell.textContent.match(/\d{8,}/) || [])[0];
      const dot = cell.querySelector('.' + DOT_CLASS);
      const want = id && unseen.includes(id);
      if (want && !dot) {
        const d = document.createElement('span');
        d.className = DOT_CLASS;
        d.title = 'WMS 새 요청';
        cell.prepend(d);
      } else if (!want && dot) {
        dot.remove();
      }
    });
  };

  // 받아 오는 일은 background.js(refreshWmsTickets)가 하고 wmsTickets에 적는다. 여기선 그걸 읽어 그린다.
  const apply = async (tickets) => {
    const ids = ((tickets && tickets.items) || []).map((x) => x.id);
    const seen = (await getSeen()) || [];
    unseen = ids.filter((id) => !seen.includes(id));
    paint();
  };
  const refresh = () => {
    try {
      chrome.runtime.sendMessage({ type: 'WMS_TICKETS_REFRESH' }, () => void chrome.runtime.lastError);
    } catch (err) {}
  };

  const markSeen = async (id) => {
    if (!unseen.includes(id)) return;
    unseen = unseen.filter((x) => x !== id);
    const seen = (await getSeen()) || [];
    if (!seen.includes(id)) setSeen([...seen, id]);
    paint();
  };

  // 줄을 누르면(요청 ID 링크든 줄 아무 데나) 본 것으로 친다.
  document.addEventListener(
    'click',
    (e) => {
      const tr = e.target.closest && e.target.closest('tr');
      if (!tr) return;
      const cell = tr.querySelector('td');
      const id = cell && (cell.textContent.match(/\d{8,}/) || [])[0];
      if (id) markSeen(id);
    },
    true
  );

  // 새로 받아 왔거나 다른 창에서 본 것으로 바뀌면 다시 그린다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes[SEEN_KEY] && !changes[TICKETS_KEY])) return;
    try {
      chrome.storage.local.get(TICKETS_KEY, (r) => apply(r && r[TICKETS_KEY]));
    } catch (err) {}
  });

  // 화면이 다시 그려져 배지·점이 지워지면 다시 붙인다.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      paint();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  try {
    chrome.storage.local.get(TICKETS_KEY, (r) => apply(r && r[TICKETS_KEY]));
  } catch (err) {}
  refresh();
})();
