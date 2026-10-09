// 물류센터 이름을 "지역+숫자"로 맞춘다(띄어쓰기 무시). 예:
//   "수도권그룹(대구3센터)" → "대구3", "로켓 인천30" → "인천30", "평택1센터" → "평택1", "인천 4" → "인천4"
// 숫자가 없는 이름("광주")이나 모양을 모르는 이름은 띄어쓰기만 정리해서 그대로 둔다.
const PREFIX = /^(로켓|쿠팡|수도권그룹|수도권|그룹|센터)+/;
export function normalizeCenter(name: unknown): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  // 괄호 안에 지역+숫자가 있으면 그것을 쓴다.
  const inner = /\(([^)]*\d[^)]*)\)/.exec(raw);
  let s = (inner ? inner[1] : raw).replace(/\s+/g, '').replace(/센터/g, '');
  const hits = s.match(/[가-힣]+\d+/g);
  if (!hits) return raw.replace(/\s+/g, ' ');
  s = hits[hits.length - 1].replace(PREFIX, '');
  return /^[가-힣]+\d+$/.test(s) ? s : hits[hits.length - 1];
}
