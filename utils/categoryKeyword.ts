// 상품명에서 쿠팡 카테고리 검색에 쓸 키워드 후보를 뽑습니다.
// 쿠팡 카테고리 검색은 한 단어로 넣어야 결과가 잘 나오므로, 문장을 통째로 넣지 않고
// 품목을 가리키는 단어 하나를 고르게 합니다.
//
// 예) "주노엘 1+1 A4 파일 클립 문서 홀더" -> ["홀더", "문서", "클립", "파일", "주노엘"]
//     한국어 상품명은 보통 끝쪽에 품목명이 오므로 뒤에서부터 후보로 삼고,
//     맨 앞 단어(대개 브랜드)는 맨 뒤로 미룹니다.

// 규격·수량·색상처럼 카테고리와 무관한 단어는 후보에서 뺍니다.
const NOISE_WORDS = new Set([
  '세트', '개입', '개', '매', '장', '팩', '박스', '묶음', '벌크',
  '대용량', '휴대용', '무료배송', '정품', '신상', '인기',
]);

const isNoise = (token: string): boolean => {
  if (token.length < 2) return true;
  if (NOISE_WORDS.has(token)) return true;
  // 숫자만("10"), 숫자+단위("100ml"), 규격("A4", "1+1")처럼 한글이 없는 토큰은 제외.
  if (!/[가-힣]/.test(token)) return true;
  // "10개입"처럼 숫자로 시작하는 수량 표기.
  if (/^\d/.test(token)) return true;
  return false;
};

export const extractCategoryKeywords = (productName: string): string[] => {
  const tokens = String(productName || '')
    .replace(/[[\](){}<>,/·]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  const usable = tokens.filter(t => !isNoise(t));
  if (usable.length === 0) return [];

  // 뒤에서부터(품목명 쪽) 후보로 삼되, 맨 앞 단어(브랜드로 추정)는 맨 뒤로 보냅니다.
  const [first, ...others] = usable;
  const ordered = others.length > 0 ? [...others.reverse(), first] : [first];

  return Array.from(new Set(ordered));
};

/** 가장 그럴듯한 키워드 하나. 검색창의 기본값으로 씁니다. */
export const guessCategoryKeyword = (productName: string): string =>
  extractCategoryKeywords(productName)[0] || '';
