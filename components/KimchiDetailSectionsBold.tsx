import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { PADDING_X, SPACE } from '../utils/detailPageLayout';
import { KimchiSection, kimchiSectionHasText } from '../utils/kimchiDetailTemplate';
import { KimchiPhoto, KIMCHI_FONT_SIZE } from './KimchiDetailSections';

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
}

const CARD_RADIUS = 30;
const CARD_MARGIN_X = 40;
const CARD_PADDING = 40;
const BOLD_SECTION_GAP = 96;
const SOFT_TINT = '#f4f1ec';
const CARD_WHITE = '#ffffff';
const CARD_BORDER = '#e6e1d9';
const DEFAULT_ACCENT = '#c9342a';

export const KimchiPreviewBold: React.FC<BoldPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale,
}) => {
  // 글자 크기는 다른 스킨과 같은 표를 쓴다 — 디자인을 바꿔도 문구 분량이 그대로여야 한다.
  const styles = useMemo(() => {
    const size = (px: number) => Math.round(px * fontScale);
    const base = (fontSize: number) => ({ fontFamily, color: textColor, fontSize });
    const center = { textAlign: 'center' as const };
    const F = KIMCHI_FONT_SIZE;
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
  }, [fontFamily, textColor, fontScale]);

  // 색을 채운 알약 배지. 섹션 라벨과 번호를 이걸로 찍는다.
  const Pill: React.FC<{ text: string; background: string; style?: React.CSSProperties }> = ({ text, background, style }) => (
    <div style={{ display: 'inline-block', background, borderRadius: 999, padding: '12px 30px' }}>
      <span style={{ ...styles.pillLabel, ...style }}>{text}</span>
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

  const SectionHead: React.FC<{ label?: string; title?: string; accent: string; onTitleChange?: (v: string) => void }> = ({
    label, title, accent, onTitleChange,
  }) => {
    if (!label?.trim() && !title?.trim()) return null;
    return (
      <div style={{ textAlign: 'center', marginBottom: SPACE.lg }}>
        {label?.trim() && <div style={{ marginBottom: SPACE.sm }}><Pill text={label} background={accent} /></div>}
        {title?.trim() && (
          onTitleChange
            ? <EditableText value={title} onChange={onTitleChange} placeholder="제목" style={styles.sectionHeading} />
            : <div style={styles.sectionHeading}>{title}</div>
        )}
      </div>
    );
  };

  const renderBody = (section: KimchiSection, photos: KimchiPhoto[], index: number) => {
    const accent = section.accentColor || DEFAULT_ACCENT;
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
          <div style={{ background: section.backgroundColor || SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <Card>
              {section.badge?.trim() && (
                <div style={{ textAlign: 'center', marginBottom: SPACE.md }}>
                  <Pill text={section.badge} background={accent} style={styles.heroBadge} />
                </div>
              )}
              {section.eyebrow?.trim() && <div style={{ marginBottom: SPACE.sm }}>{edit('eyebrow', '작은 제목', styles.heroEyebrow)}</div>}
              {section.headline?.trim() && <div style={{ marginBottom: SPACE.xs }}>{edit('headline', '큰 제목', styles.heroHeadline)}</div>}
              {section.headlineAccent?.trim() && (
                <div style={{ marginBottom: SPACE.lg }}>
                  <EditableText
                    value={section.headlineAccent}
                    onChange={v => updateSection(section.id, { headlineAccent: v })}
                    placeholder="큰 제목 2"
                    style={{ ...styles.heroHeadlineAccent, color: accent }}
                  />
                </div>
              )}
              {section.subtitle?.trim() && <div style={{ marginBottom: SPACE.lg }}>{edit('subtitle', '설명', styles.heroSubtitle)}</div>}
              {section.specValue?.trim() && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ background: '#2e2a26', padding: '16px 30px' }}>
                      <span style={styles.heroSpec}>{section.specLabel || '제품구성'}</span>
                    </div>
                    <div style={{ background: accent, padding: '16px 34px' }}>
                      {edit('specValue', '제품 구성', styles.heroSpec)}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        );

      case 'text':
        return (
          <Card background={SOFT_TINT}>
            {section.number?.trim() && (
              <div style={{ textAlign: 'center', marginBottom: SPACE.sm }}><Pill text={section.number} background={accent} /></div>
            )}
            {section.number?.trim() && section.title.trim() && (
              <div style={{ ...styles.sectionHeading, marginBottom: SPACE.sm }}>{section.title}</div>
            )}
            {edit('body', '본문', styles.featureBody)}
          </Card>
        );

      // 고지: 강조 문구를 색 채운 둥근 상자에 흰 글씨로 박고, 안내는 흰 상자로 나눈다.
      case 'notice':
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            {section.icon?.trim() && (
              <div style={{ textAlign: 'center', fontSize: Math.round(96 * fontScale), lineHeight: 1.1, marginBottom: SPACE.sm }}>
                {section.icon}
              </div>
            )}
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.xs }}>{edit('noticeTitle', '제목', styles.noticeTitle)}</div>
            )}
            {section.noticeSubtitle?.trim() && (
              <div style={{ marginBottom: SPACE.lg }}>{edit('noticeSubtitle', '부제', styles.noticeSubtitle)}</div>
            )}
            {section.bigText?.trim() && (
              <div style={{ margin: `0 ${CARD_MARGIN_X}px ${SPACE.lg}px`, background: accent, borderRadius: CARD_RADIUS, padding: '34px 0' }}>
                {edit('bigText', '강조 문구', styles.noticeBig)}
              </div>
            )}
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
                      style={styles.noticeCard}
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
              <div style={{ textAlign: 'center', fontSize: Math.round(110 * fontScale), lineHeight: 1.1, marginBottom: SPACE.sm }}>
                {section.icon}
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
                  {section.scoreSuffix?.trim() && <span style={styles.reviewScoreSuffix}>{section.scoreSuffix}</span>}
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
                        <img src={thumb.dataUrl} alt="" style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 20, flexShrink: 0, display: 'block' }} />
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

      // 특별한점: 색 채운 상자로 제목을 열고, 사진을 둥글게 자른 뒤 설명 상자를 겹쳐 올린다.
      case 'feature':
        return (
          <>
            {(section.bandSmall?.trim() || section.bandBig?.trim()) && (
              <div style={{ marginBottom: photos.length ? SPACE.md : SPACE.lg }}>
                <div style={{ margin: `0 ${CARD_MARGIN_X}px`, background: accent, borderRadius: CARD_RADIUS, padding: `${CARD_PADDING}px 0`, textAlign: 'center' }}>
                  {section.bandSmall?.trim() && (
                    <div style={{ marginBottom: SPACE.xs }}>
                      <EditableText value={section.bandSmall} onChange={v => updateSection(section.id, { bandSmall: v })} placeholder="윗줄" style={styles.featureBandSmall} />
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
                {photos.map(photo => renderPhoto(photo, 0))}
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

      // 인증: 로고를 흰 원 안에 넣고 상자 가운데에 세운다.
      case 'cert': {
        const logo = photos[0];
        return (
          <Card background={SOFT_TINT}>
            {logo && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.lg }}>
                <div style={{ width: 240, height: 240, borderRadius: '50%', background: CARD_WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={logo.dataUrl} alt="" style={{ width: 160, height: 'auto', display: 'block' }} />
                </div>
              </div>
            )}
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.md }}>{edit('noticeTitle', '인증 이름', styles.certTitle)}</div>
            )}
            {section.body?.trim() && <div style={{ marginBottom: SPACE.md }}>{edit('body', '본문', styles.certBody)}</div>}
            {section.bigText?.trim() && (
              <EditableText
                value={section.bigText}
                onChange={v => updateSection(section.id, { bigText: v })}
                placeholder="마무리"
                style={{ ...styles.certBig, color: accent }}
              />
            )}
          </Card>
        );
      }

      // 소구점: 색 배지로 번호를 찍고, 문구 상자와 사진을 좌우 번갈아 배치한다.
      case 'point': {
        const flip = index % 2 === 1;
        return (
          <>
            <Card background={SOFT_TINT}>
              <div style={{ textAlign: flip ? 'right' : 'left' }}>
                {section.badge?.trim() && (
                  <div style={{ marginBottom: SPACE.sm }}>
                    <Pill text={section.badge} background={accent} style={styles.pointBadge} />
                  </div>
                )}
                {section.noticeTitle?.trim() && (
                  <div style={{ marginBottom: SPACE.sm }}>
                    <EditableText
                      value={section.noticeTitle}
                      onChange={v => updateSection(section.id, { noticeTitle: v })}
                      placeholder="제목"
                      style={{ ...styles.pointTitle, textAlign: flip ? 'right' : 'left' }}
                    />
                  </div>
                )}
                {section.noticeSubtitle?.trim() && (
                  <EditableText
                    value={section.noticeSubtitle}
                    onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                    placeholder="설명"
                    style={{ ...styles.pointSubtitle, textAlign: flip ? 'right' : 'left' }}
                  />
                )}
              </div>
            </Card>
            {photos.length > 0 && (
              <div style={{ margin: `${SPACE.md}px ${CARD_MARGIN_X}px 0`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
                {photos.map(photo => renderPhoto(photo, 0))}
              </div>
            )}
          </>
        );
      }

      // 목록: 번호를 색 원에 넣고 항목마다 흰 상자로 띄운다.
      case 'list': {
        const items = section.items || [];
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <SectionHead label={section.caption} title={section.title} accent={accent} />
            {items.map((item, idx) =>
              item.trim() ? (
                <div key={idx} style={{ marginBottom: SPACE.sm }}>
                  <Card padding={28}>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                      <div
                        style={{
                          width: 54, height: 54, borderRadius: '50%', background: accent,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}
                      >
                        <span style={styles.listNum}>{String(idx + 1).padStart(2, '0')}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                    </div>
                  </Card>
                </div>
              ) : null
            )}
          </div>
        );
      }

      // 두 열: 질문을 색 머리에 흰 글씨로 얹은 상자로, 표는 줄무늬 상자로.
      case 'pairs': {
        const rows = section.rows || [];
        const isQna = section.pairsStyle === 'qna';
        return (
          <div style={{ background: SOFT_TINT, padding: `${SPACE.xl}px 0` }}>
            <SectionHead label={section.caption} title={section.title} accent={accent} />
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
                        <span style={{ ...styles.tableLabel, width: 240, flexShrink: 0 }}>{row.label}</span>
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
            style={{ marginBottom: BOLD_SECTION_GAP }}
          >
            {!photosInBody && section.photoPosition === 'before' && photos.map(p => renderPhoto(p, SPACE.lg))}
            {renderBody(section, photos, index)}
            {!photosInBody && section.photoPosition === 'after' && photos.map(p => renderPhoto(p, SPACE.lg))}
          </div>
        );
      })}
    </>
  );
};

export default KimchiPreviewBold;
