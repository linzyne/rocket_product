// crypto.randomUUID()는 보안 컨텍스트(HTTPS 또는 localhost)에서만 지원되어,
// http://<LAN IP>:포트 로 접속하면 존재하지 않아 앱이 렌더링 중 그대로 죽는다.
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
