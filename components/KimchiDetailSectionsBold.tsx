import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { PADDING_X, SPACE, KIMCHI_SKIN_SECTION_GAP } from '../utils/detailPageLayout';
import { KimchiSection, kimchiSectionHasText } from '../utils/kimchiDetailTemplate';
import { KimchiPhoto, KimchiTypeScale, SummaryCardBody, kimchiFontSizes, kimchiTint, makePhotoRun } from './KimchiDetailSections';

// 세 번째 스킨. 섹션 구조·문구 필드·붙여넣기 라벨은 다른 스킨과 완전히 같고 그리는 방식만 다르다.
//
// 방향: 기본 스킨이 "가운데 정렬 + 색 띠", 모던 스킨이 "왼쪽 정렬 + 얇은 선"이라면 이쪽은
// "둥근 색 상자". 섹션마다 내용을 상자에 담고 옅은 배경색을 깔아 구간을 나누며, 번호·라벨은
// 색을 채운 배지로 찍는다. 좌우 정렬을 번갈아 써서 페이지가 지루하게 흐르지 않게 한다.

interface BoldPreviewProps {
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

// 이 스킨의 뼈대: 왼쪽에 라벨·번호를 세우고 오른쪽에 내용을 놓는 2단 그리드, 그리고 밝은 구간
// 사이에 끼워 넣는 어두운 패널. 기본 스킨이 "가운데 정렬 세로 흐름"이라 색과 모서리만 바꾸면
// 같은 뼈대로 보이기 때문에, 정렬 축과 리듬 자체를 다르게 잡았다.
const SPLIT_LEFT_WIDTH = 210;
const DARK_PANEL = '#221f1c';
const ON_DARK = '#ffffff';
const CARD_RADIUS = 30;
const CARD_MARGIN_X = 40;
const CARD_PADDING = 40;
const SOFT_TINT = '#f4f1ec';
const CARD_WHITE = '#ffffff';
const CARD_BORDER = '#e6e1d9';

// 아래 세 조각은 KimchiPreviewBold 안에 두면 안 된다. 렌더마다 새 함수가 되어 React가 다른
// 컴포넌트로 보고 하위를 통째로 다시 마운트하는데, 그러면 상자 안에서 글자를 한 자 칠 때마다
// 편집 중이던 칸이 새로 그려지고 커서가 날아간다. 필요한 스타일은 인자로 받는다.

// 색을 채운 알약 배지. 섹션 라벨과 번호를 이걸로 찍는다. 배지 글자도 미리보기에서 바로 고친다.
const Pill: React.FC<{
  value: string; background: string; style: React.CSSProperties; placeholder: string; onChange: (v: string) => void;
}> = ({ value, background, style, placeholder, onChange }) => (
  <div style={{ display: 'inline-block', background, borderRadius: 999, padding: '12px 30px' }}>
    <EditableText value={value} onChange={onChange} placeholder={placeholder} style={style} />
  </div>
);

// 둥근 상자. 이 스킨의 기본 그릇이라 거의 모든 섹션이 이 안에 담긴다.
const Card: React.FC<{ children: React.ReactNode; background?: string; bordered?: boolean; padding?: number }> = ({
  children, background = CARD_WHITE, bordered = true, padding = CARD_PADDING,
}) => (
  <div
    style={{
      margin: `0 ${CARD_MARGIN_X}px`,
      background,
      borderRadius: CARD_RADIUS,
      border: bordered ? `1px solid ${CARD_BORDER}` : 'none',
      padding,
    }}
  >
    {children}
  </div>
);

// 왼쪽 칸(라벨·번호) + 오른쪽 칸(내용). 이 스킨의 기본 배치다.
const Split: React.FC<{ left: React.ReactNode; children: React.ReactNode; padded?: boolean }> = ({ left, children, padded = true }) => (
  <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', padding: padded ? `0 ${CARD_MARGIN_X}px` : 0 }}>
    <div style={{ width: SPLIT_LEFT_WIDTH, flexShrink: 0 }}>{left}</div>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

// 섹션 머리말(라벨 배지 + 제목). 둘 다 미리보기에서 바로 고칠 수 있다.
const SectionHead: React.FC<{
  section: KimchiSection;
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  accent: string;
  pillStyle: React.CSSProperties;
  headingStyle: React.CSSProperties;
}> = ({ section, updateSection, accent, pillStyle, headingStyle }) => {
  if (!section.caption?.trim() && !section.title?.trim()) return null;
  return (
    <div style={{ textAlign: 'center', marginBottom: SPACE.lg }}>
      {section.caption?.trim() && (
        <div style={{ marginBottom: SPACE.sm }}>
          <Pill
            value={section.caption}
            background={accent}
            style={pillStyle}
            placeholder="라벨"
            onChange={v => updateSection(section.id, { caption: v })}
          />
        </div>
      )}
      {section.title?.trim() && (
        <EditableText
          value={section.title}
          onChange={v => updateSection(section.id, { title: v })}
          placeholder="제목"
          style={headingStyle}
        />
      )}
    </div>
  );
};

export const KimchiPreviewBold: React.FC<BoldPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale, typeScale, accentColor: templateAccent,
}) => {
  // 사진 사이 간격은 섹션의 photoGap을 따른다 — makePhotoRun 주석 참고.
  const photoRun = makePhotoRun(renderPhoto);
  // 글자 크기는 다른 스킨과 같은 표를 쓴다 — 디자인을 바꿔도 문구 분량이 그대로여야 한다.
  const styles = useMemo(() => {
    const size = (px: number) => Math.round(px * fontScale);
    const base = (fontSize: number) => ({ fontFamily, color: textColor, fontSize });
    const center = { textAlign: 'center' as const };
    const F = kimchiFontSizes(typeScale);
    return {
      heroBadge: { ...base(size(F.heroBadge)), fontWeight: 700, letterSpacing: '0.1em', color: '#ffffff' } as React.CSSProperties,
      heroEyebrow: { ...base(size(F.heroEyebrow)), ...center, fontWeight: 400, lineHeight: 1.4, opacity: 0.7 } as React.CSSProperties,
      heroHeadline: { ...base(size(F.heroHeadline)), ...center, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      heroHeadlineAccent: { ...base(size(F.heroHeadlineAccent)), ...center, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      heroSubtitle: { ...base(size(F.heroSubtitle)), ...center, fontWeight: 400, lineHeight: 1.65, opacity: 0.8 } as React.CSSProperties,
      heroSpec: { ...base(size(F.heroSpec)), fontWeight: 700, color: '#ffffff' } as React.CSSProperties,

      pillLabel: { ...base(size(F.sectionCaption)), fontWeight: 700, letterSpacing: '0.16em', color: '#ffffff' } as React.CSSProperties,
      sectionHeading: { ...base(size(F.sectionHeading)), ...center, fontWeight: 700, lineHeight: 1.35 } as React.CSSProperties,

      noticeTitle: { ...base(size(F.noticeTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      noticeSubtitle: { ...base(size(F.noticeSubtitle)), ...center, fontWeight: 400, lineHeight: 1.4, opacity: 0.75 } as React.CSSProperties,
      noticeBig: { ...base(size(F.noticeBig)), ...center, fontWeight: 700, lineHeight: 1.1, color: '#ffffff' } as React.CSSProperties,
      noticeCard: { ...base(size(F.noticeCard)), ...center, fontWeight: 400, lineHeight: 1.6 } as React.CSSProperties,

      reviewTitle: { ...base(size(F.reviewTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      reviewSubtitle: { ...base(size(F.reviewSubtitle)), ...center, fontWeight: 400, opacity: 0.7 } as React.CSSProperties,
      reviewScore: { ...base(size(F.reviewScore)), fontWeight: 700, lineHeight: 1, color: '#ffffff' } as React.CSSProperties,
      reviewScoreSuffix: { ...base(size(F.reviewScoreSuffix)), fontWeight: 400, color: '#ffffff', opacity: 0.8 } as React.CSSProperties,
      reviewText: { ...base(size(F.reviewText)), fontWeight: 400, lineHeight: 1.7 } as React.CSSProperties,
      reviewAuthor: { ...base(size(F.reviewAuthor)), fontWeight: 400, opacity: 0.55 } as React.CSSProperties,
      reviewStars: { ...base(size(F.reviewStars)), fontWeight: 400, letterSpacing: '0.05em' } as React.CSSProperties,

      featureBandSmall: { ...base(size(F.featureBandSmall)), fontWeight: 700, lineHeight: 1.25, color: '#ffffff' } as React.CSSProperties,
      featureBandBig: { ...base(size(F.featureBandBig)), fontWeight: 700, lineHeight: 1.2, color: '#ffffff' } as React.CSSProperties,
      featureHeading: { ...base(size(F.featureHeading)), ...center, fontWeight: 700, lineHeight: 1.4 } as React.CSSProperties,
      featureBody: { ...base(size(F.featureBody)), ...center, fontWeight: 400, lineHeight: 1.7, opacity: 0.8 } as React.CSSProperties,

      certTitle: { ...base(size(F.certTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      certBody: { ...base(size(F.certBody)), ...center, fontWeight: 400, lineHeight: 1.65, opacity: 0.8 } as React.CSSProperties,
      certBig: { ...base(size(F.certBig)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,

      // 'POINT 01'에서 숫자만 뽑아 크게 세우는 자리. 문구는 그대로 두고 보여주는 방식만 바꾼다.
      bigNumeral: { ...base(size(F.reviewIcon)), fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.04em' } as React.CSSProperties,
      splitLabel: { ...base(size(F.sectionCaption)), fontWeight: 700, letterSpacing: '0.18em' } as React.CSSProperties,
      summaryIcon: { ...base(size(F.summaryIcon)), lineHeight: 1, textAlign: 'center' } as React.CSSProperties,
      summaryTitle: { ...base(size(F.summaryTitle)), fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      summaryDesc: { ...base(size(F.summaryDesc)), fontWeight: 400, lineHeight: 1.55, opacity: 0.75 } as React.CSSProperties,
      pointBadge: { ...base(size(F.pointBadge)), fontWeight: 700, letterSpacing: '0.08em', color: '#ffffff' } as React.CSSProperties,
      pointTitle: { ...base(size(F.pointTitle)), fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      pointSubtitle: { ...base(size(F.pointSubtitle)), fontWeight: 400, lineHeight: 1.55, opacity: 0.8 } as React.CSSProperties,

      listItem: { ...base(size(F.listItem)), fontWeight: 400, lineHeight: 1.6 } as React.CSSProperties,
      listNum: { ...base(size(F.sectionCaption)), fontWeight: 700, color: '#ffffff' } as React.CSSProperties,
      tableLabel: { ...base(size(F.tableText)), fontWeight: 700 } as React.CSSProperties,
      tableValue: { ...base(size(F.tableText)), fontWeight: 400, opacity: 0.8 } as React.CSSProperties,
      qnaQ: { ...base(size(F.qnaQuestion)), fontWeight: 700, lineHeight: 1.45, color: '#ffffff' } as React.CSSProperties,
      qnaA: { ...base(size(F.qnaAnswer)), fontWeight: 400, lineHeight: 1.7, opacity: 0.85 } as React.CSSProperties,
    };
  }, [fontFamily, textColor, fontScale, typeScale]);

  // 'POINT 01' → '01'. 숫자가 없으면 원문을 그대로 쓴다.
  const numeralOf = (text: string) => (text.match(/\d+/) || [text.trim()])[0];

  const renderBody = (section: KimchiSection, photos: KimchiPhoto[], index: number) => {
    const accent = section.accentColor || templateAccent;
    const edit = (field: keyof KimchiSection, placeholder: string, style: React.CSSProperties) => (
      <EditableText
        value={(section[field] as string) || ''}
        onChange={v => updateSection(section.id, { [field]: v })}
        placeholder={placeholder}
        style={style}
      />
    );

    switch (section.kind) {
      // 인트로: 옅은 색을 깐 판 위에 흰 상자를 얹어 문구를 담는다.
      case 'hero':
        return (
          <div style={{ background: DARK_PANEL, padding: `${SPACE.xl}px 0 ${SPACE.lg}px` }}>
            <div style={{ padding: `0 ${CARD_MARGIN_X}px` }}>
              {section.badge?.trim() && (
                <div style={{ marginBottom: SPACE.md }}>
                  <Pill
                    value={section.badge}
                    background={accent}
                    style={{ ...styles.pillLabel, ...styles.heroBadge }}
                    placeholder="배지"
                    onChange={v => updateSection(section.id, { badge: v })}
                  />
                </div>
              )}
              {section.eyebrow?.trim() && (
                <div style={{ marginBottom: SPACE.sm }}>
                  <EditableText value={section.eyebrow} onChange={v => updateSection(section.id, { eyebrow: v })}
                    placeholder="작은 제목" style={{ ...styles.heroEyebrow, textAlign: 'left', color: ON_DARK, opacity: 0.6 }} />
                </div>
              )}
              {section.headline?.trim() && (
                <div style={{ marginBottom: SPACE.xs }}>
                  <EditableText value={section.headline} onChange={v => updateSection(section.id, { headline: v })}
                    placeholder="큰 제목" style={{ ...styles.heroHeadline, textAlign: 'left', color: ON_DARK }} />
                </div>
              )}
              {section.headlineAccent?.trim() && (
                <div style={{ marginBottom: SPACE.lg }}>
                  <EditableText value={section.headlineAccent} onChange={v => updateSection(section.id, { headlineAccent: v })}
                    placeholder="큰 제목 2" style={{ ...styles.heroHeadlineAccent, textAlign: 'left', color: accent }} />
                </div>
              )}
              {section.subtitle?.trim() && (
                <div style={{ marginBottom: SPACE.lg }}>
                  <EditableText value={section.subtitle} onChange={v => updateSection(section.id, { subtitle: v })}
                    placeholder="설명" style={{ ...styles.heroSubtitle, textAlign: 'left', color: ON_DARK, opacity: 0.7 }} />
                </div>
              )}
              {section.specValue?.trim() && (
                <div style={{ display: 'flex', borderRadius: 999, overflow: 'hidden', alignSelf: 'flex-start', width: 'fit-content' }}>
                  <div style={{ background: ON_DARK, padding: '16px 30px' }}>
                    <EditableText
                      value={section.specLabel || ''}
                      onChange={v => updateSection(section.id, { specLabel: v })}
                      placeholder="제품구성"
                      style={{ ...styles.heroSpec, color: DARK_PANEL }}
                    />
                  </div>
                  <div style={{ background: accent, padding: '16px 34px' }}>
                    {edit('specValue', '제품 구성', styles.heroSpec)}
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'text':
        return (
          <Card background={SOFT_TINT}>
            {section.number?.trim() && (
              <div style={{ textAlign: 'center', marginBottom: SPACE.sm }}>
                <Pill
                  value={section.number}
                  background={accent}
                  style={styles.pillLabel}
                  placeholder="번호"
                  onChange={v => updateSection(section.id, { number: v })}
                />
              </div>
            )}
            {section.number?.trim() && section.title.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>{edit('title', '제목', styles.sectionHeading)}</div>
            )}
            {edit('body', '본문', styles.featureBody)}
          </Card>
        );

      // 고지: 왼쪽 칸에 아이콘과 라벨, 오른쪽 칸에 제목과 강조 문구를 세운다(2단 분할).
      case 'notice':
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <Split
              left={
                <>
                  {section.icon?.trim() && (
                    <div style={{ marginBottom: SPACE.sm }}>
                      {edit('icon', '아이콘', { fontFamily, color: textColor, fontSize: Math.round(typeScale.title * fontScale), lineHeight: 1 })}
                    </div>
                  )}
                  {section.noticeSubtitle?.trim() && (
                    <EditableText value={section.noticeSubtitle} onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                      placeholder="부제" style={{ ...styles.noticeSubtitle, textAlign: 'left' }} />
                  )}
                </>
              }
            >
              {section.noticeTitle?.trim() && (
                <div style={{ marginBottom: SPACE.sm }}>
                  <EditableText value={section.noticeTitle} onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="제목" style={{ ...styles.noticeTitle, textAlign: 'left' }} />
                </div>
              )}
              {section.bigText?.trim() && (
                <div style={{ background: accent, borderRadius: CARD_RADIUS, padding: '28px 34px', display: 'inline-block' }}>
                  <EditableText value={section.bigText} onChange={v => updateSection(section.id, { bigText: v })}
                    placeholder="강조 문구" style={{ ...styles.noticeBig, textAlign: 'left' }} />
                </div>
              )}
            </Split>
            <div style={{ height: SPACE.lg }} />
            {(section.cards || []).map((card, idx) =>
              card.trim() ? (
                <div key={idx} style={{ marginBottom: SPACE.md }}>
                  <Card>
                    <EditableText
                      value={card}
                      onChange={v => {
                        const next = [...(section.cards || [])];
                        next[idx] = v;
                        updateSection(section.id, { cards: next });
                      }}
                      placeholder="안내 문구"
                      style={{ ...styles.noticeCard, textAlign: 'left' }}
                    />
                  </Card>
                </div>
              ) : null
            )}
          </div>
        );

      // 리뷰: 평점을 색 원에 흰 글씨로 넣고, 후기는 사진을 좌우 번갈아 붙인 흰 상자로.
      case 'review': {
        const reviews = section.reviews || [];
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            {section.icon?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>
                {edit('icon', '아이콘', {
                  fontFamily, color: textColor, textAlign: 'center',
                  fontSize: Math.round(typeScale.title * fontScale), lineHeight: 1.1,
                })}
              </div>
            )}
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>{edit('noticeTitle', '제목', styles.reviewTitle)}</div>
            )}
            {section.noticeSubtitle?.trim() && (
              <div style={{ marginBottom: SPACE.lg }}>{edit('noticeSubtitle', '부제', styles.reviewSubtitle)}</div>
            )}
            {section.bigText?.trim() && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.xl }}>
                <div
                  style={{
                    width: 230, height: 230, borderRadius: '50%', background: accent,
                    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, paddingTop: 74,
                  }}
                >
                  {edit('bigText', '4.9', styles.reviewScore)}
                  {section.scoreSuffix?.trim() && edit('scoreSuffix', '/5', styles.reviewScoreSuffix)}
                </div>
              </div>
            )}
            {reviews.map((review, idx) => {
              if (!review.text.trim() && !review.author.trim()) return null;
              const thumb = photos[idx];
              const flip = idx % 2 === 1;
              const updateReview = (patch: Partial<{ text: string; author: string; stars: string }>) =>
                updateSection(section.id, { reviews: reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
              return (
                <div key={idx} style={{ marginBottom: SPACE.md }}>
                  <Card>
                    <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start', flexDirection: flip ? 'row-reverse' : 'row' }}>
                      {thumb && (
                        <img data-photo-id={thumb.id} src={thumb.dataUrl} alt="" style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 20, flexShrink: 0, display: 'block' }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: SPACE.sm }}>
                          <EditableText value={review.text} onChange={v => updateReview({ text: v })} placeholder="리뷰 내용" style={styles.reviewText} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14 }}>
                          <EditableText value={review.author} onChange={v => updateReview({ author: v })} placeholder="abcd***" style={styles.reviewAuthor} />
                          <EditableText value={review.stars} onChange={v => updateReview({ stars: v })} placeholder="★★★★★" style={{ ...styles.reviewStars, color: accent }} />
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        );
      }

      // 예고: 이 스킨의 그릇인 둥근 상자를 한 칸씩 쌓고, 아이콘은 색을 채운 원에 담는다.
      // 한 줄씩만 예고하는 자리라 상자 안에 제목·설명 두 줄만 넣는다.
      case 'summary': {
        const highlights = section.highlights || [];
        const updateHighlight = (idx: number, patch: Partial<{ icon: string; title: string; desc: string }>) =>
          updateSection(section.id, { highlights: highlights.map((h, i) => (i === idx ? { ...h, ...patch } : h)) });
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <SectionHead
              section={section}
              updateSection={updateSection}
              accent={accent}
              pillStyle={styles.pillLabel}
              headingStyle={styles.sectionHeading}
            />
            {highlights.map((highlight, idx) => {
              // 빈 칸도 그린다(눌러서 채워야 하니까). 저장 이미지에서만 뺀다 — 기본 스킨 주석 참고.
              const blank = !highlight.icon.trim() && !highlight.title.trim() && !highlight.desc.trim();
              return (
                <div
                  key={idx}
                  data-html2canvas-ignore={blank ? 'true' : undefined}
                  style={{ marginBottom: idx === highlights.length - 1 ? 0 : SPACE.sm }}
                >
                  <Card padding={34}>
                    <SummaryCardBody
                      highlight={highlight}
                      index={idx}
                      onChange={patch => updateHighlight(idx, patch)}
                      titleStyle={{ ...styles.summaryTitle, color: accent }}
                      descStyle={styles.summaryDesc}
                      iconStyle={styles.summaryIcon}
                      iconFrame={{
                        width: 124, height: 124, borderRadius: 30,
                        background: kimchiTint(accent, 0.14), border: `2px solid ${kimchiTint(accent, 0.35)}`,
                      }}
                    />
                  </Card>
                </div>
              );
            })}
          </div>
        );
      }

      // 특별한점: 색 채운 상자로 제목을 열고, 사진을 둥글게 자른 뒤 설명 상자를 겹쳐 올린다.
      case 'feature':
        return (
          <>
            {(section.bandSmall?.trim() || section.bandBig?.trim()) && (
              <div style={{ marginBottom: photos.length ? SPACE.md : SPACE.lg }}>
                <div style={{ background: DARK_PANEL, padding: `${CARD_PADDING}px ${CARD_MARGIN_X}px`, textAlign: 'left' }}>
                  {section.bandSmall?.trim() && (
                    <div style={{ marginBottom: SPACE.xs }}>
                      <EditableText value={section.bandSmall} onChange={v => updateSection(section.id, { bandSmall: v })} placeholder="윗줄" style={{ ...styles.featureBandSmall, color: accent }} />
                    </div>
                  )}
                  {section.bandBig?.trim() && (
                    <EditableText value={section.bandBig} onChange={v => updateSection(section.id, { bandBig: v })} placeholder="제목" style={styles.featureBandBig} />
                  )}
                </div>
              </div>
            )}
            {photos.length > 0 && (
              <div style={{ margin: `0 ${CARD_MARGIN_X}px ${SPACE.md}px`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
                {photoRun(section, photos, 0)}
              </div>
            )}
            {(section.heading?.trim() || section.body?.trim()) && (
              <Card background={SOFT_TINT}>
                {section.heading?.trim() && (
                  <div style={{ marginBottom: SPACE.sm }}>
                    <EditableText
                      value={section.heading}
                      onChange={v => updateSection(section.id, { heading: v })}
                      placeholder="소제목"
                      style={{ ...styles.featureHeading, color: accent }}
                    />
                  </div>
                )}
                {section.body?.trim() && edit('body', '본문', styles.featureBody)}
              </Card>
            )}
          </>
        );

      // 인증: 로고를 왼쪽 칸의 흰 원 안에 넣고, 글은 오른쪽 칸에 왼쪽 정렬로 세운다.
      case 'cert': {
        const logo = photos[0];
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <Split
              left={
                logo ? (
                  <div style={{ width: SPLIT_LEFT_WIDTH, height: SPLIT_LEFT_WIDTH, borderRadius: '50%', background: CARD_WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img data-photo-id={logo.id} src={logo.dataUrl} alt="" style={{ width: 140, height: 'auto', display: 'block' }} />
                  </div>
                ) : null
              }
            >
              {section.noticeTitle?.trim() && (
                <div style={{ marginBottom: SPACE.md }}>
                  <EditableText value={section.noticeTitle} onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="인증 이름" style={{ ...styles.certTitle, textAlign: 'left' }} />
                </div>
              )}
              {section.body?.trim() && (
                <div style={{ marginBottom: SPACE.md }}>
                  <EditableText value={section.body} onChange={v => updateSection(section.id, { body: v })}
                    placeholder="본문" style={{ ...styles.certBody, textAlign: 'left' }} />
                </div>
              )}
              {section.bigText?.trim() && (
                <EditableText value={section.bigText} onChange={v => updateSection(section.id, { bigText: v })}
                  placeholder="마무리" style={{ ...styles.certBig, textAlign: 'left', color: accent }} />
              )}
            </Split>
          </div>
        );
      }

      // 소구점: 'POINT 01'에서 숫자만 뽑아 왼쪽 칸에 크게 세우고, 문구는 오른쪽 칸에 붙인다.
      case 'point': {
        // 아직 아무것도 안 채운 소구점은 문구 칸을 전부 감추면 높이가 0이 되어 미리보기에서
        // 사라진다 — 클릭해서 타이핑할 자리도, 우클릭해서 사진을 넣을 자리도 없어진다. 빈
        // 섹션일 때는 빈 칸을 그대로 보여준다(저장 이미지에서는 stripEmptySections가 걷어낸다).
        const blank = !kimchiSectionHasText(section);
        return (
          <>
            <Split
              left={
                section.badge?.trim() ? (
                  <div style={{ ...styles.bigNumeral, color: accent }}>{numeralOf(section.badge)}</div>
                ) : null
              }
            >
              {(section.noticeTitle?.trim() || blank) && (
                <div style={{ marginBottom: SPACE.sm }}>
                  <EditableText value={section.noticeTitle || ''} onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="제목" style={{ ...styles.pointTitle, padding: 0 }} />
                </div>
              )}
              {(section.noticeSubtitle?.trim() || blank) && (
                <EditableText value={section.noticeSubtitle || ''} onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="설명" style={{ ...styles.pointSubtitle, padding: 0 }} />
              )}
            </Split>
            {photos.length > 0 && (
              <div style={{ margin: `${SPACE.lg}px ${CARD_MARGIN_X}px 0`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
                {photoRun(section, photos, 0)}
              </div>
            )}
          </>
        );
      }

      // 목록: 세로로 길게 늘어놓지 않고 두 칸씩 나란히 채운다.
      case 'list': {
        const items = section.items || [];
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <SectionHead
              section={section}
              updateSection={updateSection}
              accent={accent}
              pillStyle={styles.pillLabel}
              headingStyle={styles.sectionHeading}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, padding: `0 ${CARD_MARGIN_X}px` }}>
              {items.map((item, idx) =>
                item.trim() ? (
                  <div
                    key={idx}
                    style={{
                      width: `calc(50% - ${SPACE.sm / 2}px)`,
                      background: CARD_WHITE,
                      border: `1px solid ${CARD_BORDER}`,
                      borderRadius: CARD_RADIUS,
                      padding: 28,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ ...styles.listNum, color: accent, marginBottom: SPACE.xs }}>{String(idx + 1).padStart(2, '0')}</div>
                    <EditableText
                      value={item}
                      onChange={v => {
                        const next = [...items];
                        next[idx] = v;
                        updateSection(section.id, { items: next });
                      }}
                      placeholder="항목"
                      style={styles.listItem}
                    />
                  </div>
                ) : null
              )}
            </div>
          </div>
        );
      }

      // 두 열: 질문을 색 머리에 흰 글씨로 얹은 상자로, 표는 줄무늬 상자로.
      case 'pairs': {
        const rows = section.rows || [];
        const isQna = section.pairsStyle === 'qna';
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <SectionHead
              section={section}
              updateSection={updateSection}
              accent={accent}
              pillStyle={styles.pillLabel}
              headingStyle={styles.sectionHeading}
            />
            {isQna
              ? rows.map((row, idx) => {
                  if (!row.label.trim() && !row.value.trim()) return null;
                  const updateRow = (patch: Partial<{ label: string; value: string }>) =>
                    updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
                  return (
                    <div key={idx} style={{ margin: `0 ${CARD_MARGIN_X}px ${SPACE.md}px`, borderRadius: CARD_RADIUS, overflow: 'hidden', border: `1px solid ${CARD_BORDER}` }}>
                      <div style={{ background: accent, padding: '24px 32px' }}>
                        <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="질문" style={styles.qnaQ} />
                      </div>
                      <div style={{ background: CARD_WHITE, padding: '28px 32px' }}>
                        <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="답변" style={styles.qnaA} />
                      </div>
                    </div>
                  );
                })
              : (
                <Card padding={0}>
                  {rows.map((row, idx) => {
                    if (!row.value.trim() && !row.label.trim()) return null;
                    const updateRow = (patch: Partial<{ label: string; value: string }>) =>
                      updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
                    return (
                      <div
                        key={idx}
                        style={{ display: 'flex', gap: 20, padding: '24px 32px', background: idx % 2 === 1 ? SOFT_TINT : 'transparent' }}
                      >
                        <div style={{ width: 240, flexShrink: 0 }}>
                          <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="라벨" style={styles.tableLabel} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={styles.tableValue} />
                        </div>
                      </div>
                    );
                  })}
                </Card>
              )}
          </div>
        );
      }
    }
  };

  return (
    <>
      {sections.map((section, index) => {
        const photos = photosBySection[section.id] || [];
        const isEmpty = !kimchiSectionHasText(section) && photos.length === 0;
        const photosInBody = ['review', 'feature', 'cert', 'point'].includes(section.kind);
        return (
          <div
            key={section.id}
            data-section-id={section.id}
            data-empty-section={isEmpty ? 'true' : undefined}
            style={{ marginBottom: section.sectionGap ?? KIMCHI_SKIN_SECTION_GAP.bold }}
          >
            {!photosInBody && section.photoPosition === 'before' && photoRun(section, photos, SPACE.lg)}
            {renderBody(section, photos, index)}
            {!photosInBody && section.photoPosition === 'after' && photoRun(section, photos, SPACE.lg)}
          </div>
        );
      })}
    </>
  );
};

export default KimchiPreviewBold;
