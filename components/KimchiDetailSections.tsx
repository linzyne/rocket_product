import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { PADDING_X, RULE_COLOR, CARD_COLOR, SPACE, SECTION_GAP, DEFAULT_PHOTO_GAP, PHOTO_GAP_MAX, KIMCHI_SKIN_SECTION_GAP, SECTION_GAP_MAX } from '../utils/detailPageLayout';
import { KimchiHighlight, KimchiSection, kimchiSectionHasText, sectionBaseLabel } from '../utils/kimchiDetailTemplate';

// 김치 상세페이지 미리보기. 페이지는 "섹션 배열"이고, 섹션 하나가 [문구 + 자기 사진] 한 세트다.
// 사진은 섹션 id로 묶여 있어서(photosBySection) 업로드 순서가 배치에 영향을 주지 않는다.
//
// 사진 타입을 모달의 PhotoItem으로 받지 않고 구조만 맞춰 받는 이유: 이 컴포넌트를 모달 내부
// 타입에 묶지 않으려는 것. renderPhoto도 모달에서 통째로 넘겨받아 드래그 정렬·자르기 같은 사진
// 상호작용은 전부 모달 구현을 그대로 쓴다.
export interface KimchiPhoto {
  id: string;
  dataUrl: string;
}

// 한 섹션에 올린 사진을 세로로 이어 그리는 함수를 만든다. 스킨 네 개가 모두 이걸 쓰기 때문에
// "사진 간격"을 한 곳에서만 해석한다.
//   inner    — 그 스킨이 원래 사진 사이에 쓰던 간격. 섹션의 photoGap이 비어 있으면 이 값을 쓴다.
//   trailing — 마지막 사진 아래에 남기는 여백(다음 블록과의 거리). 기본은 inner와 같다.
// photoGap은 사진 "사이"에만 적용된다 — 마지막 사진 아래 여백까지 따라 움직이면 섹션 사이
// 리듬이 무너져서 스킨마다 잡아둔 여백이 깨진다.
export const makePhotoRun =
  (renderPhoto: (photo: KimchiPhoto, marginBottom: number) => React.ReactNode) =>
  (section: KimchiSection, photos: KimchiPhoto[], inner: number, trailing: number = inner) =>
    photos.map((photo, idx, arr) =>
      renderPhoto(photo, idx === arr.length - 1 ? trailing : section.photoGap ?? inner));

// 예고 카드에 붙는 번호. 카드 순서에서 자동으로 나오므로 문구로 받지 않는다 — 카드를 지우거나
// 순서를 바꿨을 때 번호가 어긋나는 일이 없어야 한다. 스무 개를 넘으면 그냥 숫자로 쓴다.
// #rrggbb → rgba(). 강조색에서 옅은 배경을 만들어 쓴다. 아이콘 원을 강조색으로 꽉 채우면
// 이모지가 색을 못 바꿔 원 위에서 묻히기 때문에, 원은 옅게 깔고 이모지를 그대로 얹는다.
export const kimchiTint = (hex: string, alpha: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const SUMMARY_NUMERALS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const summaryNumeral = (index: number) =>
  index < SUMMARY_NUMERALS.length ? SUMMARY_NUMERALS[index] : `${index + 1}.`;

// 예고 카드 한 칸의 속: 왼쪽에 [번호 + 제목] / [설명], 오른쪽에 아이콘 원. 스킨마다 다른 건
// 이걸 감싸는 상자(색·테두리·모서리)뿐이라 배치는 여기 한 번만 둔다.
//
// KimchiPreview 안에 두면 안 된다 — 렌더마다 새 함수가 되어 React가 다른 컴포넌트로 보고
// 하위를 다시 마운트하는데, 그러면 카드 안에서 글자를 한 자 칠 때마다 커서가 날아간다.
export const SummaryCardBody: React.FC<{
  highlight: KimchiHighlight;
  index: number;
  onChange: (patch: Partial<KimchiHighlight>) => void;
  titleStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
  iconStyle: React.CSSProperties;
  // 아이콘을 담는 틀. 모양(원/둥근 사각)·채움·테두리·크기를 스킨이 통째로 정한다 — 네 스킨이
  // 같은 원을 쓰면 예고 섹션만 봐서는 어느 디자인인지 구분이 안 된다.
  iconFrame: React.CSSProperties;
}> = ({ highlight, index, onChange, titleStyle, descStyle, iconStyle, iconFrame }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: SPACE.xs }}>
        <span style={{ ...titleStyle, flexShrink: 0 }}>{summaryNumeral(index)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditableText
            value={highlight.title}
            onChange={v => onChange({ title: v })}
            placeholder="제목"
            style={titleStyle}
          />
        </div>
      </div>
      <EditableText
        value={highlight.desc}
        onChange={v => onChange({ desc: v })}
        placeholder="설명"
        style={descStyle}
      />
    </div>
    <div
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box', ...iconFrame,
      }}
    >
      <EditableText
        value={highlight.icon}
        onChange={v => onChange({ icon: v })}
        placeholder="🌿"
        style={iconStyle}
      />
    </div>
  </div>
);

interface KimchiPreviewProps {
  sections: KimchiSection[];
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  photosBySection: Record<string, KimchiPhoto[]>;
  renderPhoto: (photo: KimchiPhoto, marginBottom: number) => React.ReactNode;
  fontFamily: string;
  textColor: string;
  fontScale: number;
  // 다섯 단계 글자 크기(사이드 패널에서 조절한 값).
  typeScale: KimchiTypeScale;
  // 템플릿 전체의 시그니처 색. 섹션이 자기 accentColor를 갖고 있으면 그쪽이 우선한다.
  accentColor: string;
}

// 860px 기준 글자 크기. 쓸 수 있는 크기는 딱 다섯 단계뿐이다 — 역할마다 값을 따로 잡으면
// 55·58·63·65처럼 눈으로 구별도 안 되는 크기가 계속 늘어나고, 그러면 어느 글이 더 중요한지
// 페이지에서 읽히지 않는다. 새 역할이 생겨도 이 다섯 개 중 하나를 고를 것 — 값을 새로 만들지 않는다.
// 다섯 단계의 실제 px은 사이드 패널("글자 단계")에서 정하고, 여기 값은 그 출발점이다.
export type KimchiTypeStepKey = 'display' | 'title' | 'heading' | 'body' | 'caption';
export type KimchiTypeScale = Record<KimchiTypeStepKey, number>;

export const KIMCHI_TYPE_SCALE: KimchiTypeScale = {
  display: 128,
  title: 96,
  heading: 65,
  body: 48,
  caption: 40,
};

// 사이드 패널에 뜨는 다섯 줄. min/max는 그 단계가 위아래 단계를 넘어가도 막지 않는다 — 막아두면
// "본문을 크게 쓰는 페이지"처럼 일부러 눌러쓰는 구성을 만들 수 없다.
export const KIMCHI_TYPE_STEPS: {
  key: KimchiTypeStepKey; label: string; hint: string; min: number; max: number;
}[] = [
  { key: 'display', label: '아주큰', hint: '고지 큰 문구·아이콘, 리뷰 평점, 인트로 강조 제목, 인증 제목', min: 60, max: 200 },
  { key: 'title', label: '대제목', hint: '인트로 큰 제목, 글 섹션 번호, 고지·리뷰 제목, 특별한점 띠 큰줄, 인증 마무리, 소구점 제목', min: 50, max: 170 },
  { key: 'heading', label: '소제목', hint: '섹션 제목, 글 섹션 제목, 특별한점 띠 작은줄·소제목, 예고 카드 제목·아이콘', min: 36, max: 130 },
  { key: 'body', label: '본문', hint: '본문, 인트로·고지·리뷰·소구점 설명, 두 열 라벨, 질문(Q), 인증 본문', min: 26, max: 100 },
  { key: 'caption', label: '작은글씨', hint: '목록 항목, 두 열 값, 표, 답변(A), 안내 카드, 리뷰 카드, 배지, 예고 카드 설명, 영문 캡션', min: 18, max: 80 },
];

// 역할 → 다섯 단계 중 하나. 한 섹션 안에서 "이게 저것보다 크다"는 관계는 그대로 지킨다
// (예: 인증은 제목 > 마무리 > 본문, 두 열은 라벨 > 값). 스킨 네 개가 이 표를 그대로 공유한다 —
// 디자인은 달라도 글자 크기는 같아야 스킨을 오가며 비교할 때 문구 분량이 유지된다.
export const kimchiFontSizes = (scale: KimchiTypeScale) => ({
  // 인트로 — 큰 제목 두 줄이 페이지의 첫 인상이라 아래쪽 줄에 가장 큰 단계를 준다.
  heroBadge: scale.caption,
  heroEyebrow: scale.body,
  heroHeadline: scale.title,
  heroHeadlineAccent: scale.display,
  heroSubtitle: scale.body,
  heroSpec: scale.caption,

  // 섹션 제목 줄
  sectionHeading: scale.heading,
  sectionCaption: scale.caption,
  textTitle: scale.heading,
  number: scale.title,

  // 본문·목록·두 열
  bodyCenter: scale.body,
  bodyLeft: scale.body,
  listItem: scale.caption,
  pairLabel: scale.body,
  pairValue: scale.caption,
  tableText: scale.caption,
  qnaQuestion: scale.body,
  qnaAnswer: scale.caption,

  // 고지 — 배송 마감시각처럼 눈에 확 들어와야 하는 구간.
  noticeIcon: scale.display,
  noticeTitle: scale.title,
  noticeSubtitle: scale.body,
  noticeBig: scale.display,
  // 안내 문구는 "오전 10시 이후 제조 및 출고 시작으로"(약 18em) 한 줄이 통째로 들어가야 어색하게
  // 끊기지 않는다. 좌우 여백 65px 기준으로 쓸 수 있는 폭이 730px이라 40px까지 들어간다 — 작은글씨
  // 단계를 그보다 키우면 이 줄이 먼저 끊긴다.
  noticeCard: scale.caption,

  // 리뷰 — 카드가 좁아서(오른쪽 썸네일 150px) 본문·작성자·별은 가장 작은 단계로 묶는다.
  reviewIcon: scale.display,
  reviewBadge: scale.caption,
  reviewTitle: scale.title,
  reviewSubtitle: scale.body,
  reviewScore: scale.display,
  reviewScoreSuffix: scale.body,
  reviewText: scale.caption,
  reviewAuthor: scale.caption,
  reviewStars: scale.caption,

  // 특별한점
  featureBandSmall: scale.heading,
  featureBandBig: scale.title,
  featureHeading: scale.heading,
  featureBody: scale.body,

  // 인증
  certTitle: scale.display,
  certBody: scale.body,
  certBig: scale.title,

  // 예고 — 카드가 여러 칸 반복되므로 제목을 소제목 단계까지만 올린다. 소구점(대제목)보다
  // 한 단계 작아야 "예고 → 자세히" 순서가 크기로도 읽힌다.
  summaryIcon: scale.heading,
  summaryTitle: scale.heading,
  summaryDesc: scale.caption,

  // 소구점 — 섹션이 여러 번 반복되므로 제목에 display를 쓰지 않는다.
  pointBadge: scale.body,
  pointTitle: scale.title,
  pointSubtitle: scale.body,
});

const TABLE_LABEL_COLUMN = 260;
// 섹션과 섹션 사이 기본 간격은 KIMCHI_SKIN_SECTION_GAP(utils/detailPageLayout.ts)에 스킨별로 모여
// 있다. 공용 SECTION_GAP(기본 템플릿도 쓴다)과 따로 두어, 김치 템플릿만 넉넉하게
// 띄운다 — 색 띠와 사진이 연달아 붙는 구성이라 좁으면 답답해 보인다.
// 인트로에서 큰 제목 덩어리끼리, 그리고 설명과 벌어지는 간격.
const HERO_BLOCK_GAP = 96;
// 리뷰 카드: 좌우 여백, 카드 안쪽 여백, 오른쪽 썸네일 한 변.
const REVIEW_CARD_MARGIN_X = 40;
const REVIEW_CARD_PADDING = 30;
const REVIEW_THUMB_SIZE = 150;
// 특별한점: 위 강조색 띠와 아래 설명 블록의 안쪽 여백, 사진 위 사선 문구의 기울기.
const FEATURE_BAND_PADDING_Y = 46;
const FEATURE_BOTTOM_PADDING_Y = 64;
const FEATURE_BAND_LINE_HEIGHT = 1.2;
// 인증: 가운데 로고 기본 가로 크기와 제목 위아래 가로줄.
const CERT_LOGO_WIDTH = 240;
const CERT_RULE_COLOR = '#d5d5d5';
// 사진이 들어갈 자리인데 아직 비어 있을 때 미리보기에만 보여주는 점선 상자. data-html2canvas-ignore
// 덕분에 저장 이미지에는 안 찍히므로, 자리를 눈으로 확인하는 용도로만 쓰인다.
const PhotoSlotPlaceholder: React.FC<{ label: string; width: number | string; height: number }> = ({ label, width, height }) => (
  <div
    data-html2canvas-ignore="true"
    style={{
      width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px dashed #c7c7c7', borderRadius: 12, color: '#a0a0a0', fontSize: 22,
      textAlign: 'center', padding: 8, boxSizing: 'border-box', flexShrink: 0,
    }}
  >
    {label}
  </div>
);
// 예고: 아이콘 카드의 좌우 여백·안쪽 여백·모서리, 그리고 왼쪽 아이콘 원의 지름.
const SUMMARY_CARD_MARGIN_X = 40;
const SUMMARY_CARD_PADDING = '32px 36px';
const SUMMARY_CARD_RADIUS = 20;
const SUMMARY_ICON_SIZE = 130;
// 소구점: 배지 알약의 안쪽 여백.
const POINT_BADGE_PADDING = '14px 40px';
// line-height가 글자 위아래로 만드는 빈 공간. 윗줄(작은 글씨)과 아랫줄(큰 글씨)의 크기가 다르면
// 이 값도 달라져서, padding을 똑같이 주면 아래쪽이 더 벌어져 보인다. 그만큼을 빼서 상쇄한다.
const bandLeading = (fontSize: number) => ((FEATURE_BAND_LINE_HEIGHT - 1) / 2) * fontSize;

export const KimchiPreview: React.FC<KimchiPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale, typeScale,
  accentColor: templateAccent,
}) => {
  // 사진 사이 간격은 섹션의 photoGap을 따른다 — makePhotoRun 주석 참고.
  const photoRun = makePhotoRun(renderPhoto);
  const fontSizes = useMemo(() => kimchiFontSizes(typeScale), [typeScale]);
  const styles = useMemo(() => {
    const size = (px: number) => Math.round(px * fontScale);
    const base = (fontSize: number) => ({ fontFamily, color: textColor, fontSize });
    const padded = { padding: `0 ${PADDING_X}px` };
    return {
      heroBadge: { ...base(size(fontSizes.heroBadge)), fontWeight: 700, lineHeight: 1.2, textAlign: 'center' } as React.CSSProperties,
      heroEyebrow: { ...base(size(fontSizes.heroEyebrow)), ...padded, fontWeight: 400, lineHeight: 1.4, textAlign: 'center' } as React.CSSProperties,
      heroHeadline: { ...base(size(fontSizes.heroHeadline)), ...padded, fontWeight: 700, lineHeight: 1.35, textAlign: 'center' } as React.CSSProperties,
      heroHeadlineAccent: { ...base(size(fontSizes.heroHeadlineAccent)), ...padded, fontWeight: 700, lineHeight: 1.35, textAlign: 'center' } as React.CSSProperties,
      heroSubtitle: { ...base(size(fontSizes.heroSubtitle)), ...padded, fontWeight: 700, lineHeight: 1.6, textAlign: 'center' } as React.CSSProperties,
      heroSpec: { ...base(size(fontSizes.heroSpec)), fontWeight: 400, lineHeight: 1.2, textAlign: 'center' } as React.CSSProperties,
      sectionHeading: { ...base(size(fontSizes.sectionHeading)), fontWeight: 700, textAlign: 'center' } as React.CSSProperties,
      sectionCaption: { ...base(size(fontSizes.sectionCaption)), fontWeight: 400, textAlign: 'center', opacity: 0.55, letterSpacing: '0.15em' } as React.CSSProperties,
      bodyCenter: { ...base(size(fontSizes.bodyCenter)), ...padded, fontWeight: 400, lineHeight: 1.9, textAlign: 'center' } as React.CSSProperties,
      bodyLeft: { ...base(size(fontSizes.bodyLeft)), ...padded, fontWeight: 400, lineHeight: 1.6, textAlign: 'left' } as React.CSSProperties,
      textTitle: { ...base(size(fontSizes.textTitle)), ...padded, fontWeight: 700, lineHeight: 1.3, textAlign: 'left' } as React.CSSProperties,
      number: { ...base(size(fontSizes.number)), ...padded, fontWeight: 700, textAlign: 'left' } as React.CSSProperties,
      listItem: { ...base(size(fontSizes.listItem)), fontWeight: 400, lineHeight: 1.6 } as React.CSSProperties,
      listItemCentered: { ...base(size(fontSizes.listItem)), fontWeight: 400, lineHeight: 1.6, textAlign: 'center' } as React.CSSProperties,
      pairLabel: { ...base(size(fontSizes.pairLabel)), fontWeight: 700, lineHeight: 1.4 } as React.CSSProperties,
      pairValue: { ...base(size(fontSizes.pairValue)), fontWeight: 400, lineHeight: 1.5, opacity: 0.75 } as React.CSSProperties,
      tableText: base(size(fontSizes.tableText)),
      noticeIcon: { ...base(size(fontSizes.noticeIcon)), lineHeight: 1.1, textAlign: 'center' } as React.CSSProperties,
      noticeTitle: { ...base(size(fontSizes.noticeTitle)), ...padded, fontWeight: 700, lineHeight: 1.25, textAlign: 'center' } as React.CSSProperties,
      noticeSubtitle: { ...base(size(fontSizes.noticeSubtitle)), ...padded, fontWeight: 400, lineHeight: 1.4, textAlign: 'center' } as React.CSSProperties,
      noticeBig: { ...base(size(fontSizes.noticeBig)), ...padded, fontWeight: 700, lineHeight: 1.15, textAlign: 'center' } as React.CSSProperties,
      noticeCard: { ...base(size(fontSizes.noticeCard)), fontWeight: 400, lineHeight: 1.6, textAlign: 'center' } as React.CSSProperties,
      reviewIcon: { ...base(size(fontSizes.reviewIcon)), lineHeight: 1.1, textAlign: 'center' } as React.CSSProperties,
      reviewBadge: { ...base(size(fontSizes.reviewBadge)), fontWeight: 700, lineHeight: 1.2, textAlign: 'center', color: '#ffffff', letterSpacing: '0.08em' } as React.CSSProperties,
      reviewTitle: { ...base(size(fontSizes.reviewTitle)), ...padded, fontWeight: 700, lineHeight: 1.25, textAlign: 'center' } as React.CSSProperties,
      reviewSubtitle: { ...base(size(fontSizes.reviewSubtitle)), ...padded, fontWeight: 400, lineHeight: 1.4, textAlign: 'center' } as React.CSSProperties,
      reviewScore: { ...base(size(fontSizes.reviewScore)), fontWeight: 700, lineHeight: 1.1, textAlign: 'center' } as React.CSSProperties,
      reviewScoreSuffix: { ...base(size(fontSizes.reviewScoreSuffix)), fontWeight: 400, lineHeight: 1.1, opacity: 0.7 } as React.CSSProperties,
      reviewText: { ...base(size(fontSizes.reviewText)), fontWeight: 400, lineHeight: 1.6, color: '#ffffff' } as React.CSSProperties,
      reviewAuthor: { ...base(size(fontSizes.reviewAuthor)), fontWeight: 400, lineHeight: 1.4, color: '#ffffff', opacity: 0.65 } as React.CSSProperties,
      reviewStars: { ...base(size(fontSizes.reviewStars)), fontWeight: 400, lineHeight: 1.2, color: '#f5b301', letterSpacing: '0.05em' } as React.CSSProperties,
      featureBandSmall: { ...base(size(fontSizes.featureBandSmall)), ...padded, fontWeight: 400, lineHeight: FEATURE_BAND_LINE_HEIGHT, textAlign: 'center', color: '#ffffff' } as React.CSSProperties,
      featureBandBig: { ...base(size(fontSizes.featureBandBig)), ...padded, fontWeight: 700, lineHeight: FEATURE_BAND_LINE_HEIGHT, textAlign: 'center', color: '#ffffff' } as React.CSSProperties,
      featureHeading: { ...base(size(fontSizes.featureHeading)), ...padded, fontWeight: 700, lineHeight: 1.5, textAlign: 'center' } as React.CSSProperties,
      featureBody: { ...base(size(fontSizes.featureBody)), ...padded, fontWeight: 400, lineHeight: 1.7, textAlign: 'center' } as React.CSSProperties,
      certTitle: { ...base(size(fontSizes.certTitle)), ...padded, fontWeight: 700, lineHeight: 1.25, textAlign: 'center' } as React.CSSProperties,
      certBody: { ...base(size(fontSizes.certBody)), ...padded, fontWeight: 400, lineHeight: 1.6, textAlign: 'center' } as React.CSSProperties,
      certBig: { ...base(size(fontSizes.certBig)), ...padded, fontWeight: 700, lineHeight: 1.3, textAlign: 'center' } as React.CSSProperties,
      summaryIcon: { ...base(size(fontSizes.summaryIcon)), lineHeight: 1, textAlign: 'center' } as React.CSSProperties,
      summaryTitle: { ...base(size(fontSizes.summaryTitle)), fontWeight: 700, lineHeight: 1.3, textAlign: 'left' } as React.CSSProperties,
      summaryDesc: { ...base(size(fontSizes.summaryDesc)), fontWeight: 400, lineHeight: 1.5, textAlign: 'left', opacity: 0.75 } as React.CSSProperties,
      pointBadge: { ...base(size(fontSizes.pointBadge)), fontWeight: 700, lineHeight: 1.2, color: '#ffffff', letterSpacing: '0.02em' } as React.CSSProperties,
      pointTitle: { ...base(size(fontSizes.pointTitle)), ...padded, fontWeight: 700, lineHeight: 1.25, textAlign: 'left' } as React.CSSProperties,
      pointSubtitle: { ...base(size(fontSizes.pointSubtitle)), ...padded, fontWeight: 400, lineHeight: 1.45, textAlign: 'left' } as React.CSSProperties,
      qnaQuestion: { ...base(size(fontSizes.qnaQuestion)), fontWeight: 700, lineHeight: 1.45, textAlign: 'left' } as React.CSSProperties,
      qnaAnswer: { ...base(size(fontSizes.qnaAnswer)), fontWeight: 400, lineHeight: 1.6, textAlign: 'left', opacity: 0.8 } as React.CSSProperties,
    };
  }, [fontFamily, textColor, fontScale, fontSizes]);

  const renderHeading = (section: KimchiSection) => {
    if (!section.title.trim() && !section.caption.trim()) return null;
    // 번호가 붙는 글 섹션(과정 01 등)은 가운데 정렬 제목 대신 왼쪽 큰 번호 + 제목으로 나간다.
    if (section.kind === 'text' && section.number?.trim()) return null;
    if (['notice', 'review', 'feature', 'cert', 'point'].includes(section.kind)) return null;
    return (
      <div style={{ marginBottom: SPACE.md }}>
        {section.caption.trim() && (
          <div style={{ marginBottom: SPACE.xs }}>
            <EditableText
              value={section.caption}
              onChange={v => updateSection(section.id, { caption: v })}
              placeholder="캡션"
              style={styles.sectionCaption}
            />
          </div>
        )}
        {section.title.trim() && (
          <EditableText
            value={section.title}
            onChange={v => updateSection(section.id, { title: v })}
            placeholder="섹션 제목"
            style={styles.sectionHeading}
          />
        )}
      </div>
    );
  };

  const renderBody = (section: KimchiSection, sectionPhotos: KimchiPhoto[]) => {
    switch (section.kind) {
      case 'hero': {
        const accent = section.accentColor || templateAccent;
        // 배지·큰 제목·제품구성 칩만 강조색을 쓰고, 나머지는 템플릿 글씨색을 그대로 따른다.
        const accented = (style: React.CSSProperties) => ({ ...style, color: accent });
        return (
          <div style={{ padding: `${SPACE.xl}px 0 ${SPACE.lg}px` }}>
            {section.badge?.trim() && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.md }}>
                <div style={{ border: `3px solid ${accent}`, borderRadius: 999, padding: '14px 46px' }}>
                  <EditableText
                    value={section.badge}
                    onChange={v => updateSection(section.id, { badge: v })}
                    placeholder="배지"
                    style={accented(styles.heroBadge)}
                  />
                </div>
              </div>
            )}
            {section.eyebrow?.trim() && (
              <div style={{ marginBottom: SPACE.xs }}>
                <EditableText
                  value={section.eyebrow}
                  onChange={v => updateSection(section.id, { eyebrow: v })}
                  placeholder="작은 제목"
                  style={styles.heroEyebrow}
                />
              </div>
            )}
            {section.headline?.trim() && (
              <div style={{ marginBottom: section.headlineAccent?.trim() ? HERO_BLOCK_GAP : SPACE.lg }}>
                <EditableText
                  value={section.headline}
                  onChange={v => updateSection(section.id, { headline: v })}
                  placeholder="큰 제목"
                  style={accented(styles.heroHeadline)}
                />
              </div>
            )}
            {section.headlineAccent?.trim() && (
              <div style={{ marginBottom: section.subtitle?.trim() ? HERO_BLOCK_GAP : SPACE.lg }}>
                <EditableText
                  value={section.headlineAccent}
                  onChange={v => updateSection(section.id, { headlineAccent: v })}
                  placeholder="큰 제목 2"
                  style={accented(styles.heroHeadlineAccent)}
                />
              </div>
            )}
            {section.subtitle?.trim() && (
              <div style={{ marginBottom: SPACE.xl }}>
                <EditableText
                  value={section.subtitle}
                  onChange={v => updateSection(section.id, { subtitle: v })}
                  placeholder="설명"
                  style={styles.heroSubtitle}
                />
              </div>
            )}
            {section.specValue?.trim() && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {/* 좌우 칩이 하나로 붙은 바 — 왼쪽은 어두운 라벨, 오른쪽은 강조색 내용 */}
                <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ background: '#2e2a26', padding: '18px 38px', display: 'flex', alignItems: 'center' }}>
                    <EditableText
                      value={section.specLabel || ''}
                      onChange={v => updateSection(section.id, { specLabel: v })}
                      placeholder="제품구성"
                      style={{ ...styles.heroSpec, color: '#ffffff', fontWeight: 700 }}
                    />
                  </div>
                  <div style={{ background: accent, padding: '18px 46px', display: 'flex', alignItems: 'center' }}>
                    <EditableText
                      value={section.specValue}
                      onChange={v => updateSection(section.id, { specValue: v })}
                      placeholder="제품 구성"
                      style={{ ...styles.heroSpec, color: '#ffffff' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'text':
        return (
          <>
            {section.number?.trim() && (
              <div style={{ marginBottom: SPACE.xs }}>
                <EditableText
                  value={section.number}
                  onChange={v => updateSection(section.id, { number: v })}
                  placeholder="번호"
                  style={styles.number}
                />
              </div>
            )}
            {section.number?.trim() && section.title.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>
                <EditableText
                  value={section.title}
                  onChange={v => updateSection(section.id, { title: v })}
                  placeholder="제목"
                  style={styles.textTitle}
                />
              </div>
            )}
            <div style={{ marginBottom: SPACE.md }}>
              <EditableText
                value={section.body || ''}
                onChange={v => updateSection(section.id, { body: v })}
                placeholder="본문"
                style={section.align === 'center' ? styles.bodyCenter : styles.bodyLeft}
              />
            </div>
          </>
        );

      case 'list': {
        const items = section.items || [];
        return (
          <>
            {items.map((item, idx) => {
              if (!item.trim()) return null;
              const update = (v: string) => {
                const next = [...items];
                next[idx] = v;
                updateSection(section.id, { items: next });
              };
              if (section.listStyle === 'card') {
                return (
                  <div key={idx} style={{ margin: `0 ${PADDING_X}px ${SPACE.sm}px`, background: CARD_COLOR, borderRadius: 14, padding: '22px 30px' }}>
                    <EditableText value={item} onChange={update} placeholder="항목" style={styles.listItemCentered} />
                  </div>
                );
              }
              const marker =
                section.listStyle === 'check' ? '✓'
                : section.listStyle === 'dot' ? '·'
                : String(idx + 1).padStart(2, '0');
              const inCard = section.listStyle === 'check';
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 18,
                    margin: `0 ${PADDING_X}px ${SPACE.sm}px`,
                    ...(inCard ? { background: CARD_COLOR, borderRadius: 14, padding: '22px 30px' } : {}),
                  }}
                >
                  <span style={{ ...styles.listItem, fontWeight: 700, opacity: inCard ? 1 : 0.45, flexShrink: 0 }}>{marker}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <EditableText value={item} onChange={update} placeholder="항목" style={styles.listItem} />
                  </div>
                </div>
              );
            })}
          </>
        );
      }

      case 'notice': {
        const cards = section.cards || [];
        const filledCards = cards.filter(c => c.trim());
        // 안내 문구를 위아래로 감싸는 점선. 마지막 문구 아래에도 한 줄 더 들어가 블록이 닫힌다.
        const divider = (marginBottom: number) => (
          <div style={{ borderTop: `2px dashed ${RULE_COLOR}`, margin: `0 ${PADDING_X}px ${marginBottom}px` }} />
        );
        return (
          <>
            {section.icon?.trim() && (
              <div style={{ marginBottom: SPACE.md }}>
                <EditableText
                  value={section.icon}
                  onChange={v => updateSection(section.id, { icon: v })}
                  placeholder="아이콘"
                  style={styles.noticeIcon}
                />
              </div>
            )}
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>
                <EditableText
                  value={section.noticeTitle}
                  onChange={v => updateSection(section.id, { noticeTitle: v })}
                  placeholder="고지 제목"
                  style={styles.noticeTitle}
                />
              </div>
            )}
            {section.noticeSubtitle?.trim() && (
              <div style={{ marginBottom: SPACE.md }}>
                <EditableText
                  value={section.noticeSubtitle}
                  onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="고지 부제"
                  style={styles.noticeSubtitle}
                />
              </div>
            )}
            {section.bigText?.trim() && (
              <div style={{ marginBottom: SPACE.xl }}>
                <EditableText
                  value={section.bigText}
                  onChange={v => updateSection(section.id, { bigText: v })}
                  placeholder="강조 문구"
                  style={styles.noticeBig}
                />
              </div>
            )}
            {cards.map((card, idx) => {
              if (!card.trim()) return null;
              return (
                <React.Fragment key={idx}>
                  {divider(SPACE.lg)}
                  <div style={{ padding: `0 ${PADDING_X}px`, marginBottom: SPACE.xl }}>
                    <EditableText
                      value={card}
                      onChange={v => {
                        const next = [...cards];
                        next[idx] = v;
                        updateSection(section.id, { cards: next });
                      }}
                      placeholder="안내 문구"
                      style={styles.noticeCard}
                    />
                  </div>
                </React.Fragment>
              );
            })}
            {filledCards.length > 0 && divider(0)}
          </>
        );
      }

      case 'point': {
        const accent = section.accentColor || templateAccent;
        // 아직 아무것도 안 채운 소구점은 문구 칸을 전부 감추면 높이가 0이 되어 미리보기에서
        // 사라진다 — 클릭해서 타이핑할 자리도, 우클릭해서 사진을 넣을 자리도 없어진다. 빈
        // 섹션일 때는 빈 칸을 그대로 보여준다(저장 이미지에서는 stripEmptySections가 걷어낸다).
        const blank = !kimchiSectionHasText(section);
        return (
          <>
            {(section.badge?.trim() || blank) && (
              <div style={{ display: 'flex', padding: `0 ${PADDING_X}px`, marginBottom: SPACE.md }}>
                <div style={{ background: accent, borderRadius: 999, padding: POINT_BADGE_PADDING }}>
                  <EditableText
                    value={section.badge || ''}
                    onChange={v => updateSection(section.id, { badge: v })}
                    placeholder="POINT 01"
                    style={styles.pointBadge}
                  />
                </div>
              </div>
            )}
            {(section.noticeTitle?.trim() || blank) && (
              <div style={{ marginBottom: SPACE.sm }}>
                <EditableText
                  value={section.noticeTitle || ''}
                  onChange={v => updateSection(section.id, { noticeTitle: v })}
                  placeholder="제목"
                  style={styles.pointTitle}
                />
              </div>
            )}
            {(section.noticeSubtitle?.trim() || blank) && (
              <div style={{ marginBottom: SPACE.lg }}>
                <EditableText
                  value={section.noticeSubtitle || ''}
                  onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="설명"
                  style={styles.pointSubtitle}
                />
              </div>
            )}
            {photoRun(section, sectionPhotos, 0)}
          </>
        );
      }

      case 'cert': {
        // 이 섹션의 사진은 전체폭이 아니라 가운데 로고로 쓴다. 제목은 위아래 가로줄 사이에 놓인다.
        const logo = sectionPhotos[0];
        const rule = (marginY: number) => (
          <div style={{ height: 1, background: CERT_RULE_COLOR, margin: `${marginY}px ${PADDING_X}px` }} />
        );
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.lg }}>
              {logo ? (
                <img
                  data-photo-id={logo.id}
                  src={logo.dataUrl}
                  alt=""
                  style={{ width: section.logoWidth || CERT_LOGO_WIDTH, height: 'auto', display: 'block' }}
                />
              ) : (
                <PhotoSlotPlaceholder label="인증 마크 자리" width={section.logoWidth || CERT_LOGO_WIDTH} height={160} />
              )}
            </div>
            {section.noticeTitle?.trim() && (
              <>
                {rule(0)}
                <div style={{ margin: `${SPACE.md}px 0` }}>
                  <EditableText
                    value={section.noticeTitle}
                    onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="인증 이름"
                    style={styles.certTitle}
                  />
                </div>
                {rule(0)}
              </>
            )}
            {section.body?.trim() && (
              <div style={{ marginTop: SPACE.lg, marginBottom: SPACE.lg }}>
                <EditableText
                  value={section.body}
                  onChange={v => updateSection(section.id, { body: v })}
                  placeholder="본문"
                  style={styles.certBody}
                />
              </div>
            )}
            {section.bigText?.trim() && (
              <EditableText
                value={section.bigText}
                onChange={v => updateSection(section.id, { bigText: v })}
                placeholder="마무리"
                style={styles.certBig}
              />
            )}
          </>
        );
      }

      // 예고: 특별한점을 아이콘 카드로 한 줄씩만 미리 보여준다. 여기서 길게 쓰지 않는 게 핵심 —
      // 자세한 내용은 뒤따르는 소구점 섹션이 사진과 함께 맡는다.
      case 'summary': {
        const accent = section.accentColor || templateAccent;
        const highlights = section.highlights || [];
        const updateHighlight = (idx: number, patch: Partial<KimchiHighlight>) =>
          updateSection(section.id, { highlights: highlights.map((h, i) => (i === idx ? { ...h, ...patch } : h)) });
        return (
          <>
            {highlights.map((highlight, idx) => {
              // 아직 안 채운 칸도 미리보기에는 그린다 — 안 그리면 눌러서 채울 자리 자체가 없다.
              // 대신 표시를 달아 저장 이미지에서는 빠진다(PhotoSlotPlaceholder와 같은 방식).
              const blank = !highlight.icon.trim() && !highlight.title.trim() && !highlight.desc.trim();
              return (
                <div
                  key={idx}
                  data-html2canvas-ignore={blank ? 'true' : undefined}
                  style={{
                    margin: `0 ${SUMMARY_CARD_MARGIN_X}px ${idx === highlights.length - 1 ? 0 : SPACE.sm}px`,
                    background: '#ffffff', borderRadius: SUMMARY_CARD_RADIUS, padding: SUMMARY_CARD_PADDING,
                  }}
                >
                  <SummaryCardBody
                    highlight={highlight}
                    index={idx}
                    onChange={patch => updateHighlight(idx, patch)}
                    titleStyle={{ ...styles.summaryTitle, color: accent }}
                    descStyle={styles.summaryDesc}
                    iconStyle={styles.summaryIcon}
                    iconFrame={{
                      width: SUMMARY_ICON_SIZE, height: SUMMARY_ICON_SIZE,
                      borderRadius: '50%', background: accent,
                    }}
                  />
                </div>
              );
            })}
          </>
        );
      }

      case 'feature': {
        const accent = section.accentColor || templateAccent;
        const hasBand = !!(section.bandSmall?.trim() || section.bandBig?.trim());
        // 띠에서 실제로 맨 위/맨 아래에 오는 줄의 글자 크기 (한 줄만 쓸 수도 있다).
        const scaled = (px: number) => Math.round(px * fontScale);
        const bandTopSize = scaled(section.bandSmall?.trim() ? fontSizes.featureBandSmall : fontSizes.featureBandBig);
        const bandBottomSize = scaled(section.bandBig?.trim() ? fontSizes.featureBandBig : fontSizes.featureBandSmall);
        const hasBottom = !!(section.heading?.trim() || section.body?.trim());
        return (
          <>
            {hasBand && (
              <div
                style={{
                  background: accent,
                  paddingTop: Math.max(0, FEATURE_BAND_PADDING_Y - bandLeading(bandTopSize)),
                  paddingBottom: Math.max(0, FEATURE_BAND_PADDING_Y - bandLeading(bandBottomSize)),
                }}
              >
                {section.bandSmall?.trim() && (
                  <div style={{ marginBottom: SPACE.xs }}>
                    <EditableText
                      value={section.bandSmall}
                      onChange={v => updateSection(section.id, { bandSmall: v })}
                      placeholder="윗줄"
                      style={styles.featureBandSmall}
                    />
                  </div>
                )}
                {section.bandBig?.trim() && (
                  <EditableText
                    value={section.bandBig}
                    onChange={v => updateSection(section.id, { bandBig: v })}
                    placeholder="제목"
                    style={styles.featureBandBig}
                  />
                )}
              </div>
            )}

            {photoRun(section, sectionPhotos, 0)}

            {hasBottom && (
              <div style={{ background: section.bottomColor || '#ddd9d5', padding: `${FEATURE_BOTTOM_PADDING_Y}px 0` }}>
                {section.heading?.trim() && (
                  <div style={{ marginBottom: section.body?.trim() ? SPACE.lg : 0 }}>
                    <EditableText
                      value={section.heading}
                      onChange={v => updateSection(section.id, { heading: v })}
                      placeholder="소제목"
                      style={{ ...styles.featureHeading, color: accent }}
                    />
                  </div>
                )}
                {section.body?.trim() && (
                  <EditableText
                    value={section.body}
                    onChange={v => updateSection(section.id, { body: v })}
                    placeholder="본문"
                    style={styles.featureBody}
                  />
                )}
              </div>
            )}
          </>
        );
      }

      case 'review': {
        const reviews = section.reviews || [];
        const accent = section.accentColor || templateAccent;
        const updateReview = (idx: number, patch: Partial<{ text: string; author: string; stars: string }>) => {
          const next = reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r));
          updateSection(section.id, { reviews: next });
        };
        return (
          <>
            {section.icon?.trim() && (
              <div style={{ marginBottom: SPACE.md }}>
                <EditableText
                  value={section.icon}
                  onChange={v => updateSection(section.id, { icon: v })}
                  placeholder="아이콘"
                  style={styles.reviewIcon}
                />
              </div>
            )}
            {section.badge?.trim() && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.md }}>
                <div style={{ background: '#f5b301', borderRadius: 999, padding: '10px 34px' }}>
                  <EditableText
                    value={section.badge}
                    onChange={v => updateSection(section.id, { badge: v })}
                    placeholder="★★★★★"
                    style={styles.reviewBadge}
                  />
                </div>
              </div>
            )}
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>
                <EditableText
                  value={section.noticeTitle}
                  onChange={v => updateSection(section.id, { noticeTitle: v })}
                  placeholder="리뷰 제목"
                  style={styles.reviewTitle}
                />
              </div>
            )}
            {section.noticeSubtitle?.trim() && (
              <div style={{ marginBottom: SPACE.md }}>
                <EditableText
                  value={section.noticeSubtitle}
                  onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="리뷰 부제"
                  style={styles.reviewSubtitle}
                />
              </div>
            )}
            {section.bigText?.trim() && (
              // 평점과 단위(/5)는 아래쪽 기준선을 맞춰 나란히 놓는다.
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginBottom: SPACE.xl }}>
                <EditableText
                  value={section.bigText}
                  onChange={v => updateSection(section.id, { bigText: v })}
                  placeholder="4.9"
                  style={styles.reviewScore}
                />
                {section.scoreSuffix?.trim() && (
                  <div style={{ paddingBottom: 14 }}>
                    <EditableText
                      value={section.scoreSuffix}
                      onChange={v => updateSection(section.id, { scoreSuffix: v })}
                      placeholder="/5"
                      style={styles.reviewScoreSuffix}
                    />
                  </div>
                )}
              </div>
            )}
            {reviews.map((review, idx) => {
              if (!review.text.trim() && !review.author.trim()) return null;
              // 이 섹션에 올린 사진을 위에서부터 차례로 한 장씩 가져다 쓴다.
              const thumb = sectionPhotos[idx];
              return (
                <div
                  key={idx}
                  style={{
                    margin: `0 ${REVIEW_CARD_MARGIN_X}px ${SPACE.md}px`,
                    background: accent,
                    borderRadius: 26,
                    padding: REVIEW_CARD_PADDING,
                  }}
                >
                  <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <EditableText
                        value={review.text}
                        onChange={v => updateReview(idx, { text: v })}
                        placeholder="리뷰 내용"
                        style={styles.reviewText}
                      />
                    </div>
                    {thumb ? (
                      <img
                        data-photo-id={thumb.id}
                        src={thumb.dataUrl}
                        alt=""
                        style={{
                          width: REVIEW_THUMB_SIZE,
                          height: REVIEW_THUMB_SIZE,
                          objectFit: 'cover',
                          borderRadius: 12,
                          flexShrink: 0,
                          display: 'block',
                        }}
                      />
                    ) : (
                      <PhotoSlotPlaceholder label={`사진 ${idx + 1}`} width={REVIEW_THUMB_SIZE} height={REVIEW_THUMB_SIZE} />
                    )}
                  </div>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.35)', margin: `${SPACE.sm}px 0` }} />
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                    <EditableText
                      value={review.author}
                      onChange={v => updateReview(idx, { author: v })}
                      placeholder="abcd***"
                      style={styles.reviewAuthor}
                    />
                    <EditableText
                      value={review.stars}
                      onChange={v => updateReview(idx, { stars: v })}
                      placeholder="★★★★★"
                      style={styles.reviewStars}
                    />
                  </div>
                </div>
              );
            })}
          </>
        );
      }

      case 'pairs': {
        const rows = section.rows || [];
        const visible = rows.filter(r => r.value.trim() || r.label.trim());
        const isTable = section.pairsStyle === 'table';
        const accentColor = section.accentColor || templateAccent;

        // 자주 묻는 질문: 라벨을 질문(Q), 값을 답변(A)으로 그리고 줄 사이를 옅은 선으로 나눈다.
        if (section.pairsStyle === 'qna') {
          return (
            <>
              {rows.map((row, idx) => {
                if (!row.label.trim() && !row.value.trim()) return null;
                const updateRow = (patch: Partial<{ label: string; value: string }>) => {
                  updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
                };
                const isLast = row === visible[visible.length - 1];
                return (
                  <React.Fragment key={idx}>
                    <div style={{ display: 'flex', gap: 14, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.sm }}>
                      <span style={{ ...styles.qnaQuestion, color: accentColor, flexShrink: 0 }}>Q.</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <EditableText
                          value={row.label}
                          onChange={v => updateRow({ label: v })}
                          placeholder="질문"
                          style={{ ...styles.qnaQuestion, color: accentColor }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 14, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.md }}>
                      <span style={{ ...styles.qnaAnswer, flexShrink: 0 }}>A.</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <EditableText
                          value={row.value}
                          onChange={v => updateRow({ value: v })}
                          placeholder="답변"
                          style={styles.qnaAnswer}
                        />
                      </div>
                    </div>
                    {!isLast && (
                      <div style={{ height: 1, background: RULE_COLOR, margin: `0 ${PADDING_X}px ${SPACE.md}px` }} />
                    )}
                  </React.Fragment>
                );
              })}
            </>
          );
        }

        return (
          <>
            {isTable && visible.length > 0 && (
              <div style={{ height: 1, background: textColor, margin: `0 ${PADDING_X}px ${SPACE.md}px` }} />
            )}
            {rows.map((row, idx) => {
              if (!row.value.trim() && !row.label.trim()) return null;
              const isLast = row === visible[visible.length - 1];
              const updateRow = (patch: Partial<{ label: string; value: string }>) => {
                const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
                updateSection(section.id, { rows: next });
              };
              if (isTable) {
                return (
                  <React.Fragment key={idx}>
                    <div style={{ display: 'flex', padding: `0 ${PADDING_X}px`, ...styles.tableText, marginBottom: SPACE.sm }}>
                      <span style={{ width: TABLE_LABEL_COLUMN, flexShrink: 0 }}>
                        <EditableText
                          value={row.label}
                          onChange={v => updateRow({ label: v })}
                          placeholder="라벨"
                          style={{ ...styles.tableText, fontWeight: 700 }}
                        />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 400 }}>
                        <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={styles.tableText} />
                      </span>
                    </div>
                    <div style={{ height: 1, background: isLast ? textColor : RULE_COLOR, margin: `0 ${PADDING_X}px ${isLast ? SPACE.lg : SPACE.sm}px` }} />
                  </React.Fragment>
                );
              }
              return (
                <React.Fragment key={idx}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.sm }}>
                    <div style={{ flexShrink: 0 }}>
                      <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="라벨" style={styles.pairLabel} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                      <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={styles.pairValue} />
                    </div>
                  </div>
                  <div style={{ height: 1, background: RULE_COLOR, margin: `0 ${PADDING_X}px ${SPACE.sm}px` }} />
                </React.Fragment>
              );
            })}
          </>
        );
      }
    }
  };

  return (
    <>
      {sections.map(section => {
        const photos = photosBySection[section.id] || [];
        // 아직 아무것도 안 채운 섹션도 미리보기에는 자리를 보여준다 — 그래야 클릭해서 바로
        // 타이핑할 수 있다. 대신 표시를 달아두고, 저장 이미지를 만들 때 사본에서 걷어낸다
        // (utils/html2canvasHelpers.ts의 stripEmptySections).
        const isEmpty = !kimchiSectionHasText(section) && photos.length === 0;
        // 리뷰 섹션은 올린 사진을 카드 오른쪽 썸네일로 직접 쓴다 — 전체폭 사진으로 또 그리면 안 된다.
        const photosConsumedByBody =
          ['review', 'feature', 'cert', 'point'].includes(section.kind);
        const renderPhotos = (trailing: number) => photoRun(section, photos, SPACE.sm, trailing);
        return (
          <div
            key={section.id}
            // 미리보기에서 우클릭한 지점이 어느 섹션인지 찾을 때 쓴다(사진을 그 자리에 끼워 넣기).
            data-section-id={section.id}
            data-empty-section={isEmpty ? 'true' : undefined}
            style={{
              marginBottom: section.sectionGap ?? KIMCHI_SKIN_SECTION_GAP.basic,
              background: section.backgroundColor || undefined,
              // 색을 칠한 섹션은 글자가 색 가장자리에 딱 붙지 않도록 위아래 여백을 준다.
              // 인트로는 자기 안쪽에서 이미 여백을 잡고 있어서 제외한다.
              ...(section.backgroundColor && section.kind !== 'hero'
                ? { paddingTop: SPACE.lg, paddingBottom: SPACE.lg }
                : {}),
            }}
          >
            {renderHeading(section)}
            {!photosConsumedByBody && section.photoPosition === 'before' && renderPhotos(SPACE.lg)}
            {renderBody(section, photos)}
            {!photosConsumedByBody && section.photoPosition === 'after' && renderPhotos(SPACE.lg)}
          </div>
        );
      })}
    </>
  );
};

export default KimchiPreview;

// ── 섹션 관리 패널 ─────────────────────────────────────────────────────────────
// 섹션 하나가 [제목 · 사진 업로드 · 순서 이동 · 삭제] 한 카드로 묶여 있다. 카드를 위아래로
// 옮기면 미리보기의 순서가 그대로 따라오고, 지우면 그 섹션에 올린 사진도 함께 사라진다.
interface KimchiSectionPanelProps {
  sections: KimchiSection[];
  photosBySection: Record<string, KimchiPhoto[]>;
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  moveSection: (id: string, direction: -1 | 1) => void;
  removeSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  // 템플릿 시그니처 색. 섹션이 자기 색을 안 가졌을 때 색상 칸에 이 값이 비쳐 보인다.
  templateAccent: string;
  // 사진을 끌어다 놓았을 때. beforePhotoId가 있으면 그 사진 앞에, 없으면 그 섹션 맨 뒤에 놓는다.
  movePhoto: (photoId: string, sectionId: string, beforePhotoId?: string) => void;
  onAddFiles: (sectionId: string, files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
  onPhotoClick: (photo: KimchiPhoto) => void;
  // 지금 고른 스킨이 섹션 사이에 쓰는 기본 간격. 섹션이 자기 sectionGap을 안 가졌을 때
  // 슬라이더에 이 값이 비쳐 보인다.
  defaultSectionGap: number;
  // 슬라이더 옆 "전체" 버튼 — 지금 값을 모든 섹션에 한 번에 먹인다. 섹션이 열 개 넘는
  // 페이지에서 하나씩 끌지 않아도 되게.
  setAllSectionGaps: (gap: number) => void;
}

const KIND_BADGE: Record<KimchiSection['kind'], string> = {
  hero: '인트로', text: '글', list: '목록', pairs: '두 열', notice: '고지', review: '리뷰',
  feature: '특별한점', cert: '인증', point: '소구점', summary: '예고',
};

export const KimchiSectionPanel: React.FC<KimchiSectionPanelProps> = ({
  sections, photosBySection, updateSection, moveSection, removeSection,
  duplicateSection, templateAccent, movePhoto, onAddFiles, onRemovePhoto, onPhotoClick,
  defaultSectionGap, setAllSectionGaps,
}) => {
  // 끌고 있는 사진 id와, 지금 올라가 있는 드롭 지점. 드롭 지점은 사진 위(그 앞에 끼워 넣기)이거나
  // 섹션의 빈 자리(맨 뒤로 보내기)다.
  const [draggingPhotoId, setDraggingPhotoId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ sectionId: string; photoId?: string } | null>(null);

  const endDrag = () => {
    setDraggingPhotoId(null);
    setDropTarget(null);
  };

  const handleDrop = (sectionId: string, beforePhotoId?: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const photoId = draggingPhotoId || e.dataTransfer.getData('text/plain');
    if (photoId) movePhoto(photoId, sectionId, beforePhotoId);
    endDrag();
  };

  // "+" 타일을 클릭해 포커스한 뒤 Ctrl/⌘+V로 클립보드 이미지를 바로 그 섹션에 넣는다
  // (기본 템플릿의 handlePastePhoto와 같은 방식).
  const handlePaste = (sectionId: string) => (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((item: DataTransferItem) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item: DataTransferItem) => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return;
    e.preventDefault();
    onAddFiles(sectionId, files);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">섹션 구성</p>
      <p className="text-xs text-slate-500 leading-relaxed">
        섹션마다 사진 칸이 따로 있어요. ↑↓로 섹션 순서를, ⧉로 섹션을 복사합니다.
        사진은 끌어서 순서를 바꾸거나 다른 섹션으로 옮길 수 있고, 클릭하면 자르기가 열려요.
        미리보기에서 원하는 자리를 우클릭하면 바로 그 자리에 사진을 넣을 수 있습니다.
        한 섹션에 사진을 두 장 이상 올리면 "사진 간격"으로 사진 사이 여백을 조절할 수 있어요.
      </p>

      {sections.map((section, index) => {
        const photos = photosBySection[section.id] || [];
        const full = !section.multiplePhotos && photos.length >= 1;
        return (
          <div key={section.id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 flex-shrink-0">
                {KIND_BADGE[section.kind]}
              </span>
              {/* 붙여넣기 라벨에 쓰이는 이름. 같은 종류가 여러 개일 때(소구점 01/02/03) 어느 섹션인지
                  이걸로 구분한다 — 제목을 비워두는 섹션이 많아서 제목만으로는 알 수 없다. */}
              <span
                title="붙여넣기 라벨에 쓰는 이름"
                className="text-[11px] font-semibold text-blue-300 flex-shrink-0 tabular-nums"
              >
                {sectionBaseLabel(section)}
              </span>
              <input
                value={section.title}
                onChange={e => updateSection(section.id, { title: e.target.value })}
                placeholder="화면에 보일 제목 (없어도 됨)"
                className="flex-1 min-w-0 px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-slate-100 placeholder:text-slate-600"
              />
              <button
                onClick={() => moveSection(section.id, -1)}
                disabled={index === 0}
                title="위로"
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-xs"
              >
                ↑
              </button>
              <button
                onClick={() => moveSection(section.id, 1)}
                disabled={index === sections.length - 1}
                title="아래로"
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-xs"
              >
                ↓
              </button>
              <button
                onClick={() => duplicateSection(section.id)}
                title="섹션 복사 (문구만 복사되고 사진은 따라오지 않습니다)"
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-xs"
              >
                ⧉
              </button>
              <button
                onClick={() => {
                  if (window.confirm('이 섹션과 여기 올린 사진을 삭제할까요?')) removeSection(section.id);
                }}
                title="섹션 삭제"
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-red-600 hover:text-white transition-colors text-xs"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                배경색
                <input
                  type="color"
                  value={section.backgroundColor || '#ffffff'}
                  onChange={e => updateSection(section.id, { backgroundColor: e.target.value })}
                  className="w-7 h-6 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                />
              </label>
              <button
                onClick={() => updateSection(section.id, { excludeFromPrompt: !section.excludeFromPrompt })}
                title={
                  section.excludeFromPrompt
                    ? '고정 문구 — AI 프롬프트에서 빠집니다. 눌러서 해제'
                    : '눌러서 고정 문구로 지정 (AI 프롬프트에서 제외)'
                }
                className={`px-1.5 h-6 rounded transition-colors text-[11px] ${
                  section.excludeFromPrompt
                    ? 'bg-amber-600 text-white hover:bg-amber-500'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {section.excludeFromPrompt ? 'AI 제외' : 'AI 포함'}
              </button>
              {section.backgroundColor && (
                <button
                  onClick={() => updateSection(section.id, { backgroundColor: undefined })}
                  title="배경색 없애기"
                  className="px-1.5 h-6 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-[11px]"
                >
                  없앰
                </button>
              )}
              {['hero', 'review', 'feature', 'point', 'summary'].includes(section.kind) && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  강조색
                  <input
                    type="color"
                    value={section.accentColor || templateAccent}
                    onChange={e => updateSection(section.id, { accentColor: e.target.value })}
                    className="w-7 h-6 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                  />
                </label>
              )}
              {section.accentColor && (
                <button
                  onClick={() => updateSection(section.id, { accentColor: undefined })}
                  title="이 섹션만 지정한 색을 지우고 템플릿 색을 따릅니다"
                  className="px-1.5 h-6 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-[11px]"
                >
                  템플릿색
                </button>
              )}
              {/* 예고 카드 수 — 특별한점 개수가 상품마다 달라서 여기서 늘리고 줄인다. 줄일 때는
                  뒤에서부터 빼므로, 남기고 싶은 칸은 앞쪽에 두면 된다. */}
              {section.kind === 'summary' && (
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  카드
                  <button
                    onClick={() => updateSection(section.id, { highlights: (section.highlights || []).slice(0, -1) })}
                    disabled={(section.highlights || []).length <= 1}
                    title="맨 뒤 카드 빼기"
                    className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    −
                  </button>
                  <span className="tabular-nums w-3 text-center text-slate-300">{(section.highlights || []).length}</span>
                  <button
                    onClick={() => updateSection(section.id, { highlights: [...(section.highlights || []), { icon: '', title: '', desc: '' }] })}
                    title="카드 더하기"
                    className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
                  >
                    +
                  </button>
                </div>
              )}
              {section.kind === 'feature' && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  아래블록
                  <input
                    type="color"
                    value={section.bottomColor || '#ddd9d5'}
                    onChange={e => updateSection(section.id, { bottomColor: e.target.value })}
                    className="w-7 h-6 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                  />
                </label>
              )}
            </div>

            <div
              onDragOver={e => {
                if (!draggingPhotoId) return;
                e.preventDefault();
                setDropTarget({ sectionId: section.id });
              }}
              onDrop={handleDrop(section.id)}
              className={`flex flex-wrap items-center gap-2 rounded-md transition-colors ${
                dropTarget?.sectionId === section.id && !dropTarget.photoId ? 'ring-2 ring-blue-500 ring-inset' : ''
              }`}
            >
              {!full && (
                <label
                  tabIndex={0}
                  onPaste={handlePaste(section.id)}
                  title="클릭해서 파일 선택, 또는 포커스 후 Ctrl+V(⌘V)로 붙여넣기"
                  className="w-14 h-14 flex items-center justify-center rounded-md border-2 border-dashed border-slate-600 text-slate-500 hover:border-blue-500 hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer transition-colors text-xl leading-none"
                >
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple={section.multiplePhotos}
                    className="sr-only"
                    onChange={e => {
                      onAddFiles(section.id, Array.from(e.target.files || []));
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              {photos.map(photo => (
                <div
                  key={photo.id}
                  className={`relative w-14 h-14 group ${
                    dropTarget?.photoId === photo.id ? 'ring-2 ring-blue-500 rounded-md' : ''
                  }`}
                  onDragOver={e => {
                    if (!draggingPhotoId || draggingPhotoId === photo.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTarget({ sectionId: section.id, photoId: photo.id });
                  }}
                  onDrop={handleDrop(section.id, photo.id)}
                >
                  <img
                    src={photo.dataUrl}
                    alt=""
                    draggable
                    onDragStart={e => {
                      setDraggingPhotoId(photo.id);
                      e.dataTransfer.setData('text/plain', photo.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={endDrag}
                    onClick={() => onPhotoClick(photo)}
                    className={`w-full h-full object-cover rounded-md border border-slate-600 cursor-grab active:cursor-grabbing ${
                      draggingPhotoId === photo.id ? 'opacity-40' : ''
                    }`}
                  />
                  <button
                    onClick={() => onRemovePhoto(photo.id)}
                    title="사진 삭제"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-600 text-slate-300 text-xs opacity-0 group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
              {photos.length === 0 && section.hint && (
                <span className="text-[11px] text-slate-500">{section.hint}</span>
              )}
            </div>

            {/* 사진 간격 — 사진 "사이"에 생기는 여백이라 두 장 이상 올린 섹션에만 뜬다.
                리뷰(카드 오른쪽 썸네일)와 인증(가운데 로고)은 사진을 이어 붙이지 않으므로 제외한다. */}
            {photos.length >= 2 && !['review', 'cert'].includes(section.kind) && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 flex-shrink-0">사진 간격</span>
                <input
                  type="range"
                  min={0}
                  max={PHOTO_GAP_MAX}
                  step={2}
                  value={section.photoGap ?? DEFAULT_PHOTO_GAP}
                  onChange={e => updateSection(section.id, { photoGap: Number(e.target.value) })}
                  title="이 섹션 사진들 사이에 남길 여백 (0이면 딱 붙습니다)"
                  className="flex-1 min-w-0 accent-blue-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-300 tabular-nums w-8 text-right flex-shrink-0">
                  {section.photoGap ?? DEFAULT_PHOTO_GAP}
                </span>
                {section.photoGap !== undefined && (
                  <button
                    onClick={() => updateSection(section.id, { photoGap: undefined })}
                    title="이 섹션만 지정한 간격을 지우고 디자인 기본 간격을 따릅니다"
                    className="px-1.5 h-6 flex-shrink-0 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-[11px]"
                  >
                    기본
                  </button>
                )}
              </div>
            )}

            {/* 섹션 간격 — 이 섹션과 "다음" 섹션 사이에 남길 여백. 마지막 섹션 뒤는 페이지 끝이라
                조절할 게 없으므로 뺀다. "전체"는 지금 값을 모든 섹션에 한 번에 먹인다. */}
            {index < sections.length - 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 flex-shrink-0">섹션 간격</span>
                <input
                  type="range"
                  min={0}
                  max={SECTION_GAP_MAX}
                  step={4}
                  value={section.sectionGap ?? defaultSectionGap}
                  onChange={e => updateSection(section.id, { sectionGap: Number(e.target.value) })}
                  title="이 섹션과 다음 섹션 사이에 남길 여백 (0이면 딱 붙습니다)"
                  className="flex-1 min-w-0 accent-emerald-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-300 tabular-nums w-8 text-right flex-shrink-0">
                  {section.sectionGap ?? defaultSectionGap}
                </span>
                <button
                  onClick={() => setAllSectionGaps(section.sectionGap ?? defaultSectionGap)}
                  title="이 값을 모든 섹션 사이 간격에 똑같이 적용합니다"
                  className="px-1.5 h-6 flex-shrink-0 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-[11px]"
                >
                  전체
                </button>
                {section.sectionGap !== undefined && (
                  <button
                    onClick={() => updateSection(section.id, { sectionGap: undefined })}
                    title="이 섹션만 지정한 간격을 지우고 디자인 기본 간격을 따릅니다"
                    className="px-1.5 h-6 flex-shrink-0 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors text-[11px]"
                  >
                    기본
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
};

// 섹션 추가 버튼은 섹션 목록과 떨어져 사이드 패널 맨 위에 놓는다 — 목록 아래에 있으면 섹션이
// 많아질수록 버튼이 멀어지고, 문구를 붙여넣기 전에 섹션부터 갖춰야 라벨이 맞기 때문이다.
export const KimchiSectionAddBar: React.FC<{ addSection: (kind: KimchiSection['kind']) => void }> = ({ addSection }) => (
  <div className="flex flex-wrap gap-1.5">
    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider w-full">섹션 추가</p>
    {(Object.keys(KIND_BADGE) as KimchiSection['kind'][]).map(kind => (
      <button
        key={kind}
        onClick={() => addSection(kind)}
        className="px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded hover:bg-slate-600 transition-colors"
      >
        + {KIND_BADGE[kind]}
      </button>
    ))}
  </div>
);
