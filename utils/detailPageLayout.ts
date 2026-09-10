// 상세페이지 렌더링에 공통으로 쓰는 치수/색 — 기본 템플릿(DetailPageBuilderModal)과 김치 템플릿
// (KimchiDetailSections)이 같은 값을 봐야 한 상세페이지 안에서 여백과 색이 어긋나지 않는다.

export const CANVAS_WIDTH = 860;
export const PADDING_X = 65;
export const RULE_COLOR = '#d9d9d9';
export const CARD_COLOR = '#f2f2f2';
export const PRODUCT_INFO_LABEL_COLUMN = 180;
// Consistent vertical-rhythm scale used for every block's spacing.
export const SPACE = { xs: 10, sm: 18, md: 28, lg: 45, xl: 60 };
// Extra breathing room between distinct sections.
export const SECTION_GAP = 70;
// 한 섹션에 올린 사진들 사이의 기본 간격. 섹션에서 photoGap으로 따로 조절할 수 있고(사이드
// 패널의 "사진 간격"), 조절하지 않은 섹션은 스킨이 원래 쓰던 간격을 그대로 쓴다.
export const DEFAULT_PHOTO_GAP = SPACE.sm;
// 사이드 패널 슬라이더가 움직일 수 있는 범위(860px 캔버스 기준 px).
export const PHOTO_GAP_MAX = 160;

// 스킨별 "섹션과 섹션 사이" 기본 간격. 섹션에서 sectionGap으로 따로 조절할 수 있고(사이드
// 패널의 "섹션 간격"), 조절하지 않은 섹션은 여기 값을 그대로 쓴다 — 그래서 예전에 만든
// 상세페이지 모양은 바뀌지 않는다. 네 스킨이 각자 상수를 들고 있으면 패널이 "지금 기본값이
// 얼마인지"를 알 수 없어서, 한 곳에 모아두고 스킨과 패널이 같은 값을 본다.
export const KIMCHI_SKIN_SECTION_GAP: Record<'basic' | 'modern' | 'bold' | 'sales', number> = {
  basic: 120,
  modern: 130,
  bold: 96,
  sales: 0,
};
// 섹션 간격 슬라이더가 움직일 수 있는 범위(860px 캔버스 기준 px).
export const SECTION_GAP_MAX = 320;
