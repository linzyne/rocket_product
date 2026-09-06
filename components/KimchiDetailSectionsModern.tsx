import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { PADDING_X, SPACE, SECTION_GAP } from '../utils/detailPageLayout';
import { KimchiSection, kimchiSectionHasText } from '../utils/kimchiDetailTemplate';
import { KimchiPhoto, KIMCHI_FONT_SIZE } from './KimchiDetailSections';

// 두 번째 스킨. 섹션 구조·문구 필드·붙여넣기 라벨은 기본 스킨과 완전히 같고, 그리는 방식만
// 다르다 — 같은 문구를 붙여넣은 채로 드롭다운만 바꿔서 두 디자인을 비교할 수 있다.
//
// 방향: 기본 스킨이 "굵고 꽉 찬 컬러 블록 + 가운데 정렬"이라면 이쪽은 "여백 넓은 왼쪽 정렬 +
// 얇은 선". 색은 강조 한 군데씩만 쓰고, 카드도 색을 채우는 대신 얇은 테두리로 두른다.

interface ModernPreviewProps {
  sections: KimchiSection[];
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  photosBySection: Record<string, KimchiPhoto[]>;
  renderPhoto: (photo: KimchiPhoto, marginBottom: number) => React.ReactNode;
  fontFamily: string;
  textColor: string;
  fontScale: number;
}

const HAIRLINE = '#e2e2e2';
const RULE = '#111111';
const MUTED = 0.55;
// 왼쪽 정렬 스킨이라 섹션마다 위쪽에 얇은 선을 긋고 그 아래 작은 라벨을 붙인다.
const MODERN_SECTION_GAP = 130;

export const KimchiPreviewModern: React.FC<ModernPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale,
}) => {
  // 글자 크기는 기본 스킨과 똑같은 표(KIMCHI_FONT_SIZE)를 쓴다. 달라지는 건 정렬·굵기·여백·선뿐이라,
  // 스킨을 바꿔도 문구가 차지하는 분량이 그대로다.
  const styles = useMemo(() => {
    const size = (px: number) => Math.round(px * fontScale);
    const base = (fontSize: number) => ({ fontFamily, color: textColor, fontSize });
    const padded = { padding: `0 ${PADDING_X}px` };
    const left = { textAlign: 'left' as const };
    const F = KIMCHI_FONT_SIZE;
    return {
      heroBadge: { ...base(size(F.heroBadge)), ...padded, ...left, fontWeight: 700, letterSpacing: '0.22em', opacity: MUTED } as React.CSSProperties,
      heroEyebrow: { ...base(size(F.heroEyebrow)), ...padded, ...left, fontWeight: 400, lineHeight: 1.5, opacity: 0.75 } as React.CSSProperties,
      heroHeadline: { ...base(size(F.heroHeadline)), ...padded, ...left, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' } as React.CSSProperties,
      heroHeadlineAccent: { ...base(size(F.heroHeadlineAccent)), ...padded, ...left, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' } as React.CSSProperties,
      heroSubtitle: { ...base(size(F.heroSubtitle)), ...padded, ...left, fontWeight: 400, lineHeight: 1.65, opacity: 0.75 } as React.CSSProperties,
      heroSpec: { ...base(size(F.heroSpec)), fontWeight: 700, letterSpacing: '0.04em' } as React.CSSProperties,
      heroSpecLabel: { ...base(size(F.heroSpec)), fontWeight: 400, letterSpacing: '0.14em', opacity: MUTED } as React.CSSProperties,

      sectionCaption: { ...base(size(F.sectionCaption)), ...padded, ...left, fontWeight: 700, letterSpacing: '0.2em', opacity: MUTED } as React.CSSProperties,
      sectionHeading: { ...base(size(F.sectionHeading)), ...padded, ...left, fontWeight: 700, lineHeight: 1.35 } as React.CSSProperties,

      // 이모지는 이 스킨에서 장식이 아니라 작은 표식이다. 기본 스킨처럼 140~170px로 키우면
      // 얇은 선과 여백으로 만든 화면에서 혼자 튄다.
      inlineIcon: { fontFamily, fontSize: size(F.sectionHeading), lineHeight: 1 } as React.CSSProperties,
      noticeTitle: { ...base(size(F.noticeTitle)), ...left, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      noticeSubtitle: { ...base(size(F.noticeSubtitle)), ...left, fontWeight: 400, lineHeight: 1.5, opacity: 0.75 } as React.CSSProperties,
      noticeBig: { ...base(size(F.noticeBig)), fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' } as React.CSSProperties,
      noticeCard: { ...base(size(F.noticeCard)), ...left, fontWeight: 400, lineHeight: 1.7 } as React.CSSProperties,

      reviewLabel: { ...base(size(F.sectionCaption)), ...padded, ...left, fontWeight: 700, letterSpacing: '0.2em', opacity: MUTED } as React.CSSProperties,
      reviewTitle: { ...base(size(F.reviewTitle)), ...padded, ...left, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
      reviewSubtitle: { ...base(size(F.reviewSubtitle)), fontWeight: 400, opacity: MUTED } as React.CSSProperties,
      reviewScore: { ...base(size(F.reviewScore)), fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' } as React.CSSProperties,
      reviewScoreSuffix: { ...base(size(F.reviewScoreSuffix)), fontWeight: 400, opacity: MUTED } as React.CSSProperties,
      reviewText: { ...base(size(F.reviewText)), ...left, fontWeight: 400, lineHeight: 1.7 } as React.CSSProperties,
      reviewAuthor: { ...base(size(F.reviewAuthor)), fontWeight: 400, letterSpacing: '0.06em', opacity: MUTED } as React.CSSProperties,
      reviewStars: { ...base(size(F.reviewStars)), fontWeight: 400, letterSpacing: '0.05em' } as React.CSSProperties,

      featureBandSmall: { ...base(size(F.featureBandSmall)), ...padded, ...left, fontWeight: 700, letterSpacing: '0.02em', opacity: MUTED } as React.CSSProperties,
      featureBandBig: { ...base(size(F.featureBandBig)), ...padded, ...left, fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.01em' } as React.CSSProperties,
      featureHeading: { ...base(size(F.featureHeading)), ...padded, ...left, fontWeight: 700, lineHeight: 1.4 } as React.CSSProperties,
      featureBody: { ...base(size(F.featureBody)), ...padded, ...left, fontWeight: 400, lineHeight: 1.7, opacity: 0.8 } as React.CSSProperties,

      certTitle: { ...base(size(F.certTitle)), ...left, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,
      certBody: { ...base(size(F.certBody)), ...left, fontWeight: 400, lineHeight: 1.65, opacity: 0.8 } as React.CSSProperties,
      certBig: { ...base(size(F.certBig)), ...left, fontWeight: 700, lineHeight: 1.25 } as React.CSSProperties,

      pointBadge: { ...base(size(F.pointBadge)), fontWeight: 700, letterSpacing: '0.16em' } as React.CSSProperties,
      pointTitle: { ...base(size(F.pointTitle)), ...padded, ...left, fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.01em' } as React.CSSProperties,
      pointSubtitle: { ...base(size(F.pointSubtitle)), ...padded, ...left, fontWeight: 400, lineHeight: 1.55, opacity: 0.8 } as React.CSSProperties,

      listItem: { ...base(size(F.listItem)), fontWeight: 400, lineHeight: 1.6 } as React.CSSProperties,
      listIndex: { ...base(size(F.sectionCaption)), fontWeight: 700, letterSpacing: '0.1em', opacity: MUTED } as React.CSSProperties,
      tableLabel: { ...base(size(F.sectionCaption)), fontWeight: 400, letterSpacing: '0.1em', opacity: MUTED } as React.CSSProperties,
      tableValue: { ...base(size(F.tableText)), fontWeight: 400, lineHeight: 1.5 } as React.CSSProperties,
      qnaQ: { ...base(size(F.qnaQuestion)), fontWeight: 700, lineHeight: 1.45 } as React.CSSProperties,
      qnaA: { ...base(size(F.qnaAnswer)), fontWeight: 400, lineHeight: 1.7, opacity: 0.8 } as React.CSSProperties,
    };
  }, [fontFamily, textColor, fontScale]);

  // 섹션 머리: 굵은 선 하나 + 작은 라벨 + 제목. 색 띠 대신 이 조합으로 구간을 나눈다.
  // onLabelChange/onTitleChange를 주면 그 줄을 미리보기에서 바로 고칠 수 있다 — 문구 필드(특별한점의
  // 윗줄·제목 등)는 반드시 편집 가능해야 하고, 섹션 제목처럼 패널에서 고치는 값은 그냥 글자로 둔다.
  const SectionHead: React.FC<{
    label?: string;
    title?: string;
    labelStyle?: React.CSSProperties;
    titleStyle?: React.CSSProperties;
    onLabelChange?: (v: string) => void;
    onTitleChange?: (v: string) => void;
  }> = ({ label, title, labelStyle, titleStyle, onLabelChange, onTitleChange }) => {
    if (!label?.trim() && !title?.trim()) return null;
    const ls = labelStyle || styles.sectionCaption;
    const ts = titleStyle || styles.sectionHeading;
    return (
      <div style={{ marginBottom: SPACE.lg }}>
        <div style={{ height: 3, background: RULE, margin: `0 ${PADDING_X}px ${SPACE.md}px` }} />
        {label?.trim() && (
          <div style={{ marginBottom: SPACE.xs }}>
            {onLabelChange
              ? <EditableText value={label} onChange={onLabelChange} placeholder="윗줄" style={ls} />
              : <div style={ls}>{label}</div>}
          </div>
        )}
        {title?.trim() && (
          onTitleChange
            ? <EditableText value={title} onChange={onTitleChange} placeholder="제목" style={ts} />
            : <div style={ts}>{title}</div>
        )}
      </div>
    );
  };

  const hairline = (marginBottom: number) => (
    <div style={{ height: 1, background: HAIRLINE, margin: `0 ${PADDING_X}px ${marginBottom}px` }} />
  );

  const renderBody = (section: KimchiSection, photos: KimchiPhoto[]) => {
    const accent = section.accentColor || '#111111';
    const edit = (field: keyof KimchiSection, placeholder: string, style: React.CSSProperties) => (
      <EditableText
        value={(section[field] as string) || ''}
        onChange={v => updateSection(section.id, { [field]: v })}
        placeholder={placeholder}
        style={style}
      />
    );

    switch (section.kind) {
      // 인트로: 배지·칩을 쓰지 않고 작은 라벨 → 큰 제목 → 설명 → 밑줄 친 구성 정보로 쌓는다.
      case 'hero':
        return (
          <div style={{ paddingTop: SPACE.xl, paddingBottom: SPACE.lg }}>
            {section.badge?.trim() && <div style={{ ...styles.heroBadge, marginBottom: SPACE.sm }}>{section.badge}</div>}
            {section.eyebrow?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>{edit('eyebrow', '작은 제목', styles.heroEyebrow)}</div>
            )}
            {section.headline?.trim() && (
              <div style={{ marginBottom: SPACE.xs }}>{edit('headline', '큰 제목', styles.heroHeadline)}</div>
            )}
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
            {section.subtitle?.trim() && (
              <div style={{ marginBottom: SPACE.xl }}>{edit('subtitle', '설명', styles.heroSubtitle)}</div>
            )}
            {section.specValue?.trim() && (
              <>
                {hairline(SPACE.sm)}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, padding: `0 ${PADDING_X}px` }}>
                  <span style={{ ...styles.heroSpecLabel, flexShrink: 0 }}>{section.specLabel || '제품구성'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{edit('specValue', '제품 구성', styles.heroSpec)}</div>
                </div>
                <div style={{ height: 1, background: HAIRLINE, margin: `${SPACE.sm}px ${PADDING_X}px 0` }} />
              </>
            )}
          </div>
        );

      case 'text':
        return (
          <>
            {section.number?.trim() && (
              <div style={{ ...styles.sectionCaption, marginBottom: SPACE.xs }}>{section.number}</div>
            )}
            {section.number?.trim() && section.title.trim() && (
              <div style={{ ...styles.sectionHeading, marginBottom: SPACE.sm }}>{section.title}</div>
            )}
            {edit('body', '본문', styles.featureBody)}
          </>
        );

      // 고지: 큰 숫자를 가운데 박는 대신 제목과 강조 문구를 좌우로 마주 놓고, 안내는 얇은 테두리 상자.
      case 'notice':
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.md }}>
              <div style={{ minWidth: 0 }}>
                {section.icon?.trim() && <div style={{ ...styles.inlineIcon, marginBottom: SPACE.sm }}>{section.icon}</div>}
                {section.noticeTitle?.trim() && (
                  <EditableText
                    value={section.noticeTitle}
                    onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="제목"
                    style={styles.noticeTitle}
                  />
                )}
                {section.noticeSubtitle?.trim() && (
                  <EditableText
                    value={section.noticeSubtitle}
                    onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                    placeholder="부제"
                    style={styles.noticeSubtitle}
                  />
                )}
              </div>
              {section.bigText?.trim() && (
                <div style={{ flexShrink: 0 }}>
                  <EditableText
                    value={section.bigText}
                    onChange={v => updateSection(section.id, { bigText: v })}
                    placeholder="강조 문구"
                    style={{ ...styles.noticeBig, color: accent }}
                  />
                </div>
              )}
            </div>
            {(section.cards || []).map((card, idx) =>
              card.trim() ? (
                <div
                  key={idx}
                  style={{
                    margin: `0 ${PADDING_X}px ${SPACE.sm}px`,
                    border: `1px solid ${HAIRLINE}`,
                    borderLeft: `4px solid ${RULE}`,
                    padding: '30px 32px',
                  }}
                >
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
          </>
        );

      // 리뷰: 색으로 채운 카드 대신 흰 카드에 얇은 테두리, 사진은 원형으로 작게.
      case 'review': {
        const reviews = section.reviews || [];
        return (
          <>
            <SectionHead
              label={section.icon?.trim() ? `${section.icon}  REVIEW` : 'REVIEW'}
              title={section.noticeTitle}
              labelStyle={styles.reviewLabel}
              titleStyle={styles.reviewTitle}
              onTitleChange={v => updateSection(section.id, { noticeTitle: v })}
            />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.lg }}>
              {section.bigText?.trim() && (
                <EditableText
                  value={section.bigText}
                  onChange={v => updateSection(section.id, { bigText: v })}
                  placeholder="4.9"
                  style={{ ...styles.reviewScore, color: accent }}
                />
              )}
              {section.scoreSuffix?.trim() && <span style={styles.reviewScoreSuffix}>{section.scoreSuffix}</span>}
              {section.noticeSubtitle?.trim() && (
                <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                  <EditableText
                    value={section.noticeSubtitle}
                    onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                    placeholder="부제"
                    style={{ ...styles.reviewSubtitle, textAlign: 'right' }}
                  />
                </div>
              )}
            </div>
            {reviews.map((review, idx) => {
              if (!review.text.trim() && !review.author.trim()) return null;
              const thumb = photos[idx];
              const updateReview = (patch: Partial<{ text: string; author: string; stars: string }>) =>
                updateSection(section.id, { reviews: reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
              return (
                <div
                  key={idx}
                  style={{
                    margin: `0 ${PADDING_X}px ${SPACE.md}px`,
                    border: `1px solid ${HAIRLINE}`,
                    padding: '30px 32px',
                    display: 'flex',
                    gap: 26,
                    alignItems: 'flex-start',
                  }}
                >
                  {thumb && (
                    <img
                      src={thumb.dataUrl}
                      alt=""
                      style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: SPACE.sm }}>
                      <EditableText value={review.text} onChange={v => updateReview({ text: v })} placeholder="리뷰 내용" style={styles.reviewText} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                      <EditableText value={review.author} onChange={v => updateReview({ author: v })} placeholder="abcd***" style={styles.reviewAuthor} />
                      <EditableText value={review.stars} onChange={v => updateReview({ stars: v })} placeholder="★★★★★" style={{ ...styles.reviewStars, color: accent }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        );
      }

      // 특별한점: 컬러 띠를 없애고 얇은 선 + 작은 라벨 + 큰 제목, 사진은 그 아래 전체폭.
      case 'feature':
        return (
          <>
            <SectionHead
              label={section.bandSmall}
              title={section.bandBig}
              labelStyle={styles.featureBandSmall}
              titleStyle={styles.featureBandBig}
              onLabelChange={v => updateSection(section.id, { bandSmall: v })}
              onTitleChange={v => updateSection(section.id, { bandBig: v })}
            />
            {photos.map(photo => renderPhoto(photo, SPACE.lg))}
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
          </>
        );

      // 인증: 로고를 가운데 크게 놓는 대신 왼쪽에 두고 글을 오른쪽에 세운다.
      case 'cert': {
        const logo = photos[0];
        return (
          <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start', padding: `0 ${PADDING_X}px` }}>
            {logo && <img src={logo.dataUrl} alt="" style={{ width: 170, height: 'auto', flexShrink: 0, display: 'block' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              {section.noticeTitle?.trim() && (
                <div style={{ marginBottom: SPACE.sm }}>
                  <EditableText
                    value={section.noticeTitle}
                    onChange={v => updateSection(section.id, { noticeTitle: v })}
                    placeholder="인증 이름"
                    style={styles.certTitle}
                  />
                </div>
              )}
              {section.body?.trim() && (
                <div style={{ marginBottom: SPACE.md }}>
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
                  style={{ ...styles.certBig, color: accent }}
                />
              )}
            </div>
          </div>
        );
      }

      // 소구점: 알약 배지 대신 큰 번호와 얇은 선으로 구간을 연다.
      case 'point':
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.sm }}>
              {section.badge?.trim() && (
                <EditableText
                  value={section.badge}
                  onChange={v => updateSection(section.id, { badge: v })}
                  placeholder="POINT 01"
                  style={{ ...styles.pointBadge, color: accent }}
                />
              )}
              <div style={{ flex: 1, height: 1, background: HAIRLINE }} />
            </div>
            {section.noticeTitle?.trim() && (
              <div style={{ marginBottom: SPACE.sm }}>
                <EditableText
                  value={section.noticeTitle}
                  onChange={v => updateSection(section.id, { noticeTitle: v })}
                  placeholder="제목"
                  style={styles.pointTitle}
                />
              </div>
            )}
            {section.noticeSubtitle?.trim() && (
              <div style={{ marginBottom: SPACE.lg }}>
                <EditableText
                  value={section.noticeSubtitle}
                  onChange={v => updateSection(section.id, { noticeSubtitle: v })}
                  placeholder="설명"
                  style={styles.pointSubtitle}
                />
              </div>
            )}
            {photos.map(photo => renderPhoto(photo, 0))}
          </>
        );

      // 목록: 카드 없이 번호 + 얇은 구분선.
      case 'list': {
        const items = section.items || [];
        const visible = items.filter(v => v.trim());
        return (
          <>
            <SectionHead label={section.caption} title={section.title} />
            {items.map((item, idx) => {
              if (!item.trim()) return null;
              const isLast = item === visible[visible.length - 1];
              return (
                <React.Fragment key={idx}>
                  <div style={{ display: 'flex', gap: 20, padding: `0 ${PADDING_X}px`, marginBottom: SPACE.sm }}>
                    <span style={{ ...styles.listIndex, flexShrink: 0, paddingTop: 6 }}>{String(idx + 1).padStart(2, '0')}</span>
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
                  {!isLast && hairline(SPACE.sm)}
                </React.Fragment>
              );
            })}
          </>
        );
      }

      // 두 열: 표는 라벨을 작게 위에 얹고 값을 아래 큰 글씨로 — 좁은 라벨 칸 없이 왼쪽으로 흐른다.
      case 'pairs': {
        const rows = section.rows || [];
        const visible = rows.filter(r => r.value.trim() || r.label.trim());
        const isQna = section.pairsStyle === 'qna';
        return (
          <>
            <SectionHead label={section.caption} title={section.title} />
            {rows.map((row, idx) => {
              if (!row.value.trim() && !row.label.trim()) return null;
              const isLast = row === visible[visible.length - 1];
              const updateRow = (patch: Partial<{ label: string; value: string }>) =>
                updateSection(section.id, { rows: rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
              if (isQna) {
                return (
                  <React.Fragment key={idx}>
                    <div style={{ padding: `0 ${PADDING_X}px`, marginBottom: SPACE.xs }}>
                      <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="질문" style={{ ...styles.qnaQ, color: accent }} />
                    </div>
                    <div style={{ padding: `0 ${PADDING_X}px`, marginBottom: SPACE.md }}>
                      <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="답변" style={styles.qnaA} />
                    </div>
                    {!isLast && hairline(SPACE.md)}
                  </React.Fragment>
                );
              }
              return (
                <React.Fragment key={idx}>
                  <div style={{ padding: `0 ${PADDING_X}px`, marginBottom: SPACE.xs }}>
                    <div style={{ ...styles.tableLabel, marginBottom: 4 }}>{row.label}</div>
                    <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={styles.tableValue} />
                  </div>
                  {!isLast && hairline(SPACE.sm)}
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
        const isEmpty = !kimchiSectionHasText(section) && photos.length === 0;
        // 사진을 본문 안에서 직접 배치하는 종류들 — 바깥에서 또 그리면 두 번 나온다.
        const photosInBody = ['review', 'feature', 'cert', 'point'].includes(section.kind);
        return (
          <div
            key={section.id}
            data-section-id={section.id}
            data-empty-section={isEmpty ? 'true' : undefined}
            style={{
              marginBottom: MODERN_SECTION_GAP,
              background: section.backgroundColor || undefined,
              ...(section.backgroundColor ? { paddingTop: SPACE.lg, paddingBottom: SPACE.lg } : {}),
            }}
          >
            {!photosInBody && section.photoPosition === 'before' && photos.map(p => renderPhoto(p, SPACE.lg))}
            {renderBody(section, photos)}
            {!photosInBody && section.photoPosition === 'after' && photos.map(p => renderPhoto(p, SPACE.lg))}
          </div>
        );
      })}
    </>
  );
};

export default KimchiPreviewModern;
