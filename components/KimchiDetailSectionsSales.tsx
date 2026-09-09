import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { PADDING_X, SPACE } from '../utils/detailPageLayout';
import { KimchiSection, kimchiSectionHasText } from '../utils/kimchiDetailTemplate';
import { KimchiPhoto, KIMCHI_FONT_SIZE, makePhotoRun } from './KimchiDetailSections';

// 네 번째 스킨. 국내 식품 상세페이지에서 흔한 "설득형" 구성을 옮긴 것 —
// 체크포인트 배지, 말풍선으로 늘어놓는 공감 문구, 시그니처 색을 꽉 채운 인증 패널이 특징이다.
// 섹션 구조와 붙여넣기 라벨은 다른 스킨과 완전히 같고 그리는 방식만 다르다.
//
// 색은 시그니처 색 하나에서 파생시킨다(tint). 그래서 초록을 빨강으로 바꾸면 옅은 배경 톤까지
// 함께 따라온다 — 스킨마다 색을 고정해두면 "초록 전용 템플릿"이 되어버린다.

interface SalesPreviewProps {
  sections: KimchiSection[];
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  photosBySection: Record<string, KimchiPhoto[]>;
  renderPhoto: (photo: KimchiPhoto, marginBottom: number) => React.ReactNode;
  fontFamily: string;
  textColor: string;
  fontScale: number;
  accentColor: string;
}

const CREAM = '#f7f1e6';
const PANEL_RADIUS = 24;
const BUBBLE_RADIUS = 999;
const SALES_SECTION_GAP = 0;
const CARD_MARGIN_X = 46;

// #rrggbb → rgba(). 시그니처 색에서 옅은 배경과 테두리를 만들어 쓴다.
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(47, 158, 68, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const KimchiPreviewSales: React.FC<SalesPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale, accentColor: templateAccent,
}) => {
  // 사진 사이 간격은 섹션의 photoGap을 따른다 — makePhotoRun 주석 참고.
  const photoRun = makePhotoRun(renderPhoto);
  const styles = useMemo(() => {
    const size = (px: number) => Math.round(px * fontScale);
    const base = (fontSize: number) => ({ fontFamily, color: textColor, fontSize });
    const center = { textAlign: 'center' as const };
    const F = KIMCHI_FONT_SIZE;
    return {
      heroEyebrow: { ...base(size(F.heroEyebrow)), ...center, fontWeight: 700, lineHeight: 1.4 } as React.CSSProperties,
      heroHeadline: { ...base(size(F.heroHeadline)), ...center, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      heroHeadlineAccent: { ...base(size(F.heroHeadlineAccent)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      heroSubtitle: { ...base(size(F.heroSubtitle)), ...center, fontWeight: 400, lineHeight: 1.6, opacity: 0.75 } as React.CSSProperties,
      heroSpec: { ...base(size(F.heroSpec)), ...center, fontWeight: 700, color: '#ffffff' } as React.CSSProperties,
      badge: { ...base(size(F.sectionCaption)), fontWeight: 700, letterSpacing: '0.08em' } as React.CSSProperties,
      sectionHeading: { ...base(size(F.sectionHeading)), ...center, fontWeight: 700, lineHeight: 1.35 } as React.CSSProperties,

      noticeTitle: { ...base(size(F.noticeTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      noticeSubtitle: { ...base(size(F.noticeSubtitle)), ...center, fontWeight: 400, lineHeight: 1.4, opacity: 0.75 } as React.CSSProperties,
      noticeBig: { ...base(size(F.noticeBig)), ...center, fontWeight: 700, lineHeight: 1.1, color: '#ffffff' } as React.CSSProperties,
      noticeCard: { ...base(size(F.noticeCard)), ...center, fontWeight: 400, lineHeight: 1.6 } as React.CSSProperties,

      reviewTitle: { ...base(size(F.reviewTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      reviewSubtitle: { ...base(size(F.reviewSubtitle)), ...center, fontWeight: 400, opacity: 0.7 } as React.CSSProperties,
      reviewScore: { ...base(size(F.reviewScore)), fontWeight: 700, lineHeight: 1 } as React.CSSProperties,
      reviewScoreSuffix: { ...base(size(F.reviewScoreSuffix)), fontWeight: 400, opacity: 0.6 } as React.CSSProperties,
      reviewText: { ...base(size(F.reviewText)), fontWeight: 400, lineHeight: 1.7 } as React.CSSProperties,
      reviewAuthor: { ...base(size(F.reviewAuthor)), fontWeight: 400, opacity: 0.55 } as React.CSSProperties,
      reviewStars: { ...base(size(F.reviewStars)), fontWeight: 400, letterSpacing: '0.05em' } as React.CSSProperties,

      featureTitle: { ...base(size(F.featureBandBig)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      featureSub: { ...base(size(F.featureHeading)), ...center, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      featureBody: { ...base(size(F.featureBody)), ...center, fontWeight: 400, lineHeight: 1.7, opacity: 0.75 } as React.CSSProperties,

      certTitle: { ...base(size(F.certTitle)), ...center, fontWeight: 700, lineHeight: 1.25, color: '#ffffff' } as React.CSSProperties,
      certBody: { ...base(size(F.certBody)), ...center, fontWeight: 400, lineHeight: 1.65, color: '#ffffff', opacity: 0.85 } as React.CSSProperties,
      certBig: { ...base(size(F.certBig)), ...center, fontWeight: 700, lineHeight: 1.25, color: '#ffffff' } as React.CSSProperties,

      pointTitle: { ...base(size(F.pointTitle)), ...center, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      pointSubtitle: { ...base(size(F.pointSubtitle)), ...center, fontWeight: 400, lineHeight: 1.55, opacity: 0.75 } as React.CSSProperties,

      bubble: { ...base(size(F.listItem)), fontWeight: 700, lineHeight: 1.5 } as React.CSSProperties,
      stepNum: { ...base(size(F.sectionCaption)), fontWeight: 700, color: '#ffffff' } as React.CSSProperties,
      tableLabel: { ...base(size(F.tableText)), fontWeight: 400, opacity: 0.7 } as React.CSSProperties,
      tableValue: { ...base(size(F.tableText)), fontWeight: 400 } as React.CSSProperties,
      qnaQ: { ...base(size(F.qnaQuestion)), fontWeight: 700, lineHeight: 1.45 } as React.CSSProperties,
      qnaA: { ...base(size(F.qnaAnswer)), fontWeight: 400, lineHeight: 1.7, opacity: 0.8 } as React.CSSProperties,
    };
  }, [fontFamily, textColor, fontScale]);

  // "Check Point. 1" 처럼 섹션을 여는 작은 알약 배지 — 이 스킨의 표식이다.
  const CheckBadge: React.FC<{ text: string; accent: string }> = ({ text, accent }) => (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.md }}>
      <div style={{ background: '#ffffff', border: `2px solid ${accent}`, borderRadius: BUBBLE_RADIUS, padding: '12px 34px' }}>
        <span style={{ ...styles.badge, color: accent }}>{text}</span>
      </div>
    </div>
  );

  // 옅은 시그니처 색을 깐 판. 섹션을 구간으로 끊는 데 쓴다.
  const Panel: React.FC<{ children: React.ReactNode; background: string; padded?: boolean }> = ({ children, background, padded = true }) => (
    <div style={{ background, padding: padded ? `${SPACE.xl}px 0` : 0 }}>{children}</div>
  );

  const renderBody = (section: KimchiSection, photos: KimchiPhoto[]) => {
    const accent = section.accentColor || templateAccent;
    const soft = tint(accent, 0.08);
    const edit = (field: keyof KimchiSection, placeholder: string, style: React.CSSProperties) => (
      <EditableText
        value={(section[field] as string) || ''}
        onChange={v => updateSection(section.id, { [field]: v })}
        placeholder={placeholder}
        style={style}
      />
    );

    switch (section.kind) {
      // 인트로: 옅은 시그니처 톤 위에 문구를 얹고, 제품구성은 색을 꽉 채운 띠로 아래에 깐다.
      case 'hero':
        return (
          <>
            <Panel background={soft}>
              {section.badge?.trim() && (
                <div style={{ ...styles.heroEyebrow, color: accent, marginBottom: SPACE.sm }}>{section.badge}</div>
              )}
              {section.eyebrow?.trim() && <div style={{ marginBottom: SPACE.sm }}>{edit('eyebrow', '작은 제목', styles.heroEyebrow)}</div>}
              {section.headline?.trim() && <div style={{ marginBottom: SPACE.xs }}>{edit('headline', '큰 제목', styles.heroHeadline)}</div>}
              {section.headlineAccent?.trim() && (
                <div style={{ marginBottom: SPACE.lg }}>
                  <EditableText value={section.headlineAccent} onChange={v => updateSection(section.id, { headlineAccent: v })}
                    placeholder="큰 제목 2" style={{ ...styles.heroHeadlineAccent, color: accent }} />
                </div>
              )}
              {section.subtitle?.trim() && <div>{edit('subtitle', '설명', styles.heroSubtitle)}</div>}
            </Panel>
            {section.specValue?.trim() && (
              <div style={{ background: accent, padding: `${SPACE.md}px 0` }}>
                {edit('specValue', '제품 구성', styles.heroSpec)}
              </div>
            )}
          </>
        );

      case 'text':
        return (
          <Panel background={CREAM}>
            {section.number?.trim() && <CheckBadge text={`Check Point. ${section.number}`} accent={accent} />}
            {section.number?.trim() && section.title.trim() && (
              <div style={{ ...styles.featureTitle, marginBottom: SPACE.md }}>{section.title}</div>
            )}
            {edit('body', '본문', styles.featureBody)}
          </Panel>
        );

      // 고지: 옅은 톤 판 위에 아이콘·제목, 강조 문구는 색을 채운 알약으로.
      case 'notice':
        return (
          <Panel background={soft}>
            {section.icon?.trim() && (
              <div style={{ textAlign: 'center', fontSize: Math.round(110 * fontScale), lineHeight: 1.1, marginBottom: SPACE.sm }}>{section.icon}</div>
            )}
            {section.noticeSubtitle?.trim() && <div style={{ marginBottom: SPACE.xs }}>{edit('noticeSubtitle', '부제', styles.noticeSubtitle)}</div>}
            {section.noticeTitle?.trim() && <div style={{ marginBottom: SPACE.md }}>{edit('noticeTitle', '제목', styles.noticeTitle)}</div>}
            {section.bigText?.trim() && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.lg }}>
                <div style={{ background: accent, borderRadius: BUBBLE_RADIUS, padding: '22px 60px' }}>
                  {edit('bigText', '강조 문구', styles.noticeBig)}
                </div>
              </div>
            )}
            {(section.cards || []).map((card, idx) =>
              card.trim() ? (
                <div key={idx} style={{ margin: `0 ${CARD_MARGIN_X}px ${SPACE.sm}px`, background: '#ffffff', borderRadius: PANEL_RADIUS, padding: '30px 34px' }}>
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
                </div>
              ) : null
            )}
          </Panel>
        );

      // 리뷰: 후기를 말풍선처럼 좌우로 번갈아 띄운다(공감 문구와 같은 어법).
      case 'review': {
        const reviews = section.reviews || [];
        return (
          <Panel background={CREAM}>
            {section.icon?.trim() && (
              <div style={{ textAlign: 'center', fontSize: Math.round(110 * fontScale), lineHeight: 1.1, marginBottom: SPACE.sm }}>{section.icon}</div>
            )}
            {section.noticeTitle?.trim() && <div style={{ marginBottom: SPACE.sm }}>{edit('noticeTitle', '제목', styles.reviewTitle)}</div>}
            {section.noticeSubtitle?.trim() && <div style={{ marginBottom: SPACE.md }}>{edit('noticeSubtitle', '부제', styles.reviewSubtitle)}</div>}
            {section.bigText?.trim() && (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginBottom: SPACE.lg }}>
                <EditableText value={section.bigText} onChange={v => updateSection(section.id, { bigText: v })}
                  placeholder="4.9" style={{ ...styles.reviewScore, color: accent }} />
                {section.scoreSuffix?.trim() && <span style={styles.reviewScoreSuffix}>{section.scoreSuffix}</span>}
              </div>
            )}
            {reviews.map((review, idx) => {
              if (!review.text.trim() && !review.author.trim()) return null;
              const thumb = photos[idx];
              const flip = idx % 2 === 1;
              const updateReview = (patch: Partial<{ text: string; author: string; stars: string }>) =>
                updateSection(section.id, { reviews: reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: flip ? 'flex-end' : 'flex-start', padding: `0 ${CARD_MARGIN_X}px`, marginBottom: SPACE.sm }}>
                  <div style={{ maxWidth: '84%', background: '#ffffff', border: `2px solid ${accent}`, borderRadius: 30, padding: '26px 30px', display: 'flex', gap: 20, alignItems: 'center' }}>
                    {thumb && <img src={thumb.dataUrl} alt="" style={{ width: 120, height: 120, borderRadius: 18, objectFit: 'cover', flexShrink: 0, display: 'block' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: SPACE.xs }}>
                        <EditableText value={review.text} onChange={v => updateReview({ text: v })} placeholder="리뷰 내용" style={styles.reviewText} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                        <EditableText value={review.author} onChange={v => updateReview({ author: v })} placeholder="abcd***" style={styles.reviewAuthor} />
                        <EditableText value={review.stars} onChange={v => updateReview({ stars: v })} placeholder="★★★★★" style={{ ...styles.reviewStars, color: accent }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </Panel>
        );
      }

      // 특별한점: 체크포인트 배지 + 두 줄 제목(아래 줄은 시그니처 색) + 설명 + 전체폭 사진.
      case 'feature':
        return (
          <>
            <div style={{ padding: `${SPACE.xl}px 0 ${SPACE.lg}px` }}>
              {section.bandSmall?.trim() && <CheckBadge text={section.bandSmall} accent={accent} />}
              {section.bandBig?.trim() && (
                <div style={{ marginBottom: SPACE.xs }}>
                  <EditableText value={section.bandBig} onChange={v => updateSection(section.id, { bandBig: v })}
                    placeholder="제목" style={styles.featureTitle} />
                </div>
              )}
              {section.heading?.trim() && (
                <div style={{ marginBottom: SPACE.md }}>
                  <EditableText value={section.heading} onChange={v => updateSection(section.id, { heading: v })}
                    placeholder="소제목" style={{ ...styles.featureSub, color: accent }} />
                </div>
              )}
              {section.body?.trim() && edit('body', '본문', styles.featureBody)}
            </div>
            {photoRun(section, photos, 0)}
          </>
        );

      // 인증: 시그니처 색을 꽉 채운 판에 흰 원 로고와 흰 글씨 — 페이지에서 가장 강한 구간.
      case 'cert': {
        const logo = photos[0];
        return (
          <Panel background={accent}>
            {logo && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: SPACE.md }}>
                <div style={{ width: 210, height: 210, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={logo.dataUrl} alt="" style={{ width: 140, height: 'auto', display: 'block' }} />
                </div>
              </div>
            )}
            {section.bigText?.trim() && <div style={{ marginBottom: SPACE.sm }}>{edit('bigText', '마무리', styles.certBig)}</div>}
            {section.noticeTitle?.trim() && <div style={{ marginBottom: SPACE.sm }}>{edit('noticeTitle', '인증 이름', styles.certTitle)}</div>}
            {section.body?.trim() && edit('body', '본문', styles.certBody)}
          </Panel>
        );
      }

      // 소구점: 체크포인트 배지로 열고 제목·설명을 가운데, 사진은 전체폭으로.
      case 'point':
        return (
          <>
            <div style={{ padding: `${SPACE.xl}px 0 ${SPACE.lg}px` }}>
              {section.badge?.trim() && <CheckBadge text={`Check Point. ${(section.badge.match(/\d+/) || ['1'])[0]}`} accent={accent} />}
              {section.noticeTitle?.trim() && (
                <div style={{ marginBottom: SPACE.sm }}>
                  <EditableText value={section.noticeTitle} onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="제목" style={{ ...styles.pointTitle, padding: `0 ${PADDING_X}px` }} />
                </div>
              )}
              {section.noticeSubtitle?.trim() && (
                <EditableText value={section.noticeSubtitle} onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="설명" style={{ ...styles.pointSubtitle, padding: `0 ${PADDING_X}px` }} />
              )}
            </div>
            {photoRun(section, photos, 0)}
          </>
        );

      // 목록: 공감 문구를 말풍선으로 좌우 번갈아 늘어놓는다 — 이 구성의 핵심 장치.
      case 'list': {
        const items = section.items || [];
        return (
          <Panel background={CREAM}>
            {section.title.trim() && <div style={{ ...styles.featureTitle, marginBottom: SPACE.lg }}>{section.title}</div>}
            {items.map((item, idx) =>
              item.trim() ? (
                <div key={idx} style={{ display: 'flex', justifyContent: idx % 2 === 1 ? 'flex-end' : 'flex-start', padding: `0 ${CARD_MARGIN_X}px`, marginBottom: SPACE.sm }}>
                  <div style={{ maxWidth: '80%', background: '#ffffff', border: `2px solid ${accent}`, borderRadius: BUBBLE_RADIUS, padding: '20px 34px' }}>
                    <EditableText
                      value={item}
                      onChange={v => {
                        const next = [...items];
                        next[idx] = v;
                        updateSection(section.id, { items: next });
                      }}
                      placeholder="항목"
                      style={styles.bubble}
                    />
                  </div>
                </div>
              ) : null
            )}
          </Panel>
        );
      }

      // 두 열: 표시사항은 회색 머리 + 두 칸 표로, Q&A는 말풍선 문답으로.
      case 'pairs': {
        const rows = section.rows || [];
        const isQna = section.pairsStyle === 'qna';
        if (isQna) {
          return (
            <Panel background={CREAM}>
              {section.title.trim() && <div style={{ ...styles.featureTitle, marginBottom: SPACE.lg }}>{section.title}</div>}
              {rows.map((row, idx) => {
                if (!row.label.trim() && !row.value.trim()) return null;
                const updateRow = (patch: Partial<{ label: string; value: string }>) =>
                  updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
                return (
                  <div key={idx} style={{ padding: `0 ${CARD_MARGIN_X}px`, marginBottom: SPACE.md }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: SPACE.xs }}>
                      <div style={{ maxWidth: '86%', background: accent, borderRadius: 26, padding: '20px 30px' }}>
                        <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="질문" style={{ ...styles.qnaQ, color: '#ffffff' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ maxWidth: '86%', background: '#ffffff', border: `2px solid ${tint(accent, 0.3)}`, borderRadius: 26, padding: '20px 30px' }}>
                        <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="답변" style={styles.qnaA} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </Panel>
          );
        }
        return (
          <Panel background="#ffffff">
            {section.title.trim() && <div style={{ ...styles.featureTitle, marginBottom: SPACE.lg }}>{section.title}</div>}
            <div style={{ margin: `0 ${CARD_MARGIN_X}px`, border: `1px solid ${tint(accent, 0.25)}` }}>
              {rows.map((row, idx) => {
                if (!row.value.trim() && !row.label.trim()) return null;
                const updateRow = (patch: Partial<{ label: string; value: string }>) =>
                  updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
                return (
                  <div key={idx} style={{ display: 'flex', borderTop: idx === 0 ? 'none' : `1px solid ${tint(accent, 0.18)}` }}>
                    <div style={{ width: 250, flexShrink: 0, background: soft, padding: '22px 26px' }}>
                      <span style={styles.tableLabel}>{row.label}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, padding: '22px 26px' }}>
                      <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={styles.tableValue} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      }
    }
  };

  return (
    <>
      {sections.map(section => {
        const photos = photosBySection[section.id] || [];
        const isEmpty = !kimchiSectionHasText(section) && photos.length === 0;
        const photosInBody = ['review', 'feature', 'cert', 'point'].includes(section.kind);
        return (
          <div
            key={section.id}
            data-section-id={section.id}
            data-empty-section={isEmpty ? 'true' : undefined}
            style={{ marginBottom: SALES_SECTION_GAP }}
          >
            {!photosInBody && section.photoPosition === 'before' && photoRun(section, photos, 0)}
            {renderBody(section, photos)}
            {!photosInBody && section.photoPosition === 'after' && photoRun(section, photos, 0)}
          </div>
        );
      })}
    </>
  );
};

export default KimchiPreviewSales;
