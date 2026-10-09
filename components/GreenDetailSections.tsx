import React, { useMemo } from 'react';
import EditableText from './EditableText';
import { KimchiSection, kimchiSectionHasText } from '../utils/kimchiDetailTemplate';
import { KimchiPhoto, KimchiTypeScale, kimchiTint, makePhotoRun } from './KimchiDetailSections';

// 초록(체크포인트형) 틀. 섹션 배열·사진 칸·붙여넣기 라벨은 김치 틀과 같은 엔진이고
// (utils/kimchiDetailTemplate.ts의 g* 종류), 여기서는 그리는 방식만 맡는다.
//
// 흐름: 인트로(제품 + 장점 띠) → 공감(말풍선) → 소개 → 비교표 → Check Point ×N → 인증(강조색 바탕)
// → 활용법(단계) → 구성 → 제품 상세 정보. 섹션마다 바탕색을 칠하고 섹션 사이를 띄우지 않아,
// 색 구간이 맞붙어 이어지는 모양이다.

interface GreenPreviewProps {
  sections: KimchiSection[];
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  photosBySection: Record<string, KimchiPhoto[]>;
  renderPhoto: (photo: KimchiPhoto, marginBottom: number) => React.ReactNode;
  fontFamily: string;
  textColor: string;
  fontScale: number;
  typeScale: KimchiTypeScale;
  accentColor: string;
}

const SIDE = 70;
const GRAY_TEXT = '#6b6b6b';
const COMPARE_GRAY = '#707070';
const TABLE_LINE = '#dcdcdc';
const TABLE_LABEL_BG = '#f4f4f4';

// 사진을 꽉 채워 자른 네모/동그라미. <img object-fit>은 저장 이미지(html2canvas)에서 찌그러지므로
// 배경 이미지로 그린다. 자르기는 사이드 패널 썸네일을 눌러서 한다.
const PhotoBox: React.FC<{ photo?: KimchiPhoto; size: number; round?: boolean; radius?: number; contain?: boolean; style?: React.CSSProperties }> = ({
  photo, size, round, radius = 16, contain, style,
}) => (
  <div
    style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: round ? '50%' : radius,
      backgroundColor: photo ? '#ffffff' : '#e5e5e5',
      backgroundImage: photo ? `url(${photo.dataUrl})` : undefined,
      backgroundSize: contain ? 'contain' : 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      ...style,
    }}
  />
);

export const GreenPreview: React.FC<GreenPreviewProps> = ({
  sections, updateSection, photosBySection, renderPhoto, fontFamily, textColor, fontScale, typeScale, accentColor: templateAccent,
}) => {
  const photoRun = makePhotoRun(renderPhoto);
  const S = useMemo(() => {
    const px = (v: number) => Math.round(v * fontScale);
    const t = (fontSize: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
      fontFamily, color: textColor, fontSize: px(fontSize), lineHeight: 1.35, textAlign: 'center', ...extra,
    });
    const small = typeScale.caption * 0.8;
    return {
      heroEyebrow: t(typeScale.caption, { fontWeight: 700 }),
      heroTitle: t(typeScale.title, { fontWeight: 800, lineHeight: 1.15 }),
      statTitle: t(small, { fontWeight: 500, color: '#ffffff', opacity: 0.9 }),
      statValue: t(small, { fontWeight: 800, color: '#ffffff' }),
      statIcon: t(typeScale.heading * 0.85, { lineHeight: 1 }),
      eyebrow: t(small * 1.05, { fontWeight: 700 }),
      title: t(typeScale.heading, { fontWeight: 800, lineHeight: 1.3 }),
      sub: t(typeScale.heading * 0.75, { fontWeight: 800, lineHeight: 1.35 }),
      body: t(small, { fontWeight: 400, lineHeight: 1.6, color: GRAY_TEXT }),
      bubble: t(small, { fontWeight: 600, color: '#ffffff', textAlign: 'left' }),
      checkLabel: t(small * 0.95, { fontWeight: 800, letterSpacing: '0.02em' }),
      compareHead: t(small * 1.1, { fontWeight: 800 }),
      compareCell: t(small * 0.9, { fontWeight: 600, color: '#ffffff', lineHeight: 1.45 }),
      comparePill: t(small * 0.85, { fontWeight: 800, lineHeight: 1.2 }),
      stepTitle: t(small * 1.1, { fontWeight: 800, textAlign: 'left' }),
      stepDesc: t(small * 0.9, { fontWeight: 400, lineHeight: 1.55, textAlign: 'left', color: GRAY_TEXT }),
      pill: t(small * 1.05, { fontWeight: 800, color: '#ffffff' }),
      tableLabel: t(small * 0.85, { fontWeight: 700, textAlign: 'left' }),
      tableValue: t(small * 0.85, { fontWeight: 400, textAlign: 'left', lineHeight: 1.5 }),
    };
  }, [fontFamily, textColor, fontScale, typeScale]);

  const renderBody = (section: KimchiSection, photos: KimchiPhoto[], checkNumber: number) => {
    const accent = section.accentColor || templateAccent;
    const blank = !kimchiSectionHasText(section);
    // 비어 있는 섹션은 칸을 다 보여줘야 클릭해서 바로 칠 수 있다(저장 이미지에서는 빈 섹션째 빠진다).
    const show = (v?: string) => !!v?.trim() || blank;
    const edit = (field: keyof KimchiSection, placeholder: string, style: React.CSSProperties) => (
      <EditableText
        value={(section[field] as string) || ''}
        onChange={v => updateSection(section.id, { [field]: v })}
        placeholder={placeholder}
        style={style}
      />
    );
    const editHighlight = (idx: number, key: 'icon' | 'title' | 'desc', placeholder: string, style: React.CSSProperties) => (
      <EditableText
        value={(section.highlights || [])[idx]?.[key] || ''}
        onChange={v => {
          const next = [...(section.highlights || [])];
          next[idx] = { ...next[idx], [key]: v };
          updateSection(section.id, { highlights: next });
        }}
        placeholder={placeholder}
        style={style}
      />
    );
    const gap = (h: number) => <div style={{ height: h }} />;

    switch (section.kind) {
      // 인트로: 작은 문구 → 큰 제목(앞은 검정, 뒤는 강조색) → 제품 사진 → 강조색 띠의 장점 칸.
      case 'gHero': {
        const stats = section.highlights || [];
        return (
          <div style={{ paddingTop: 90 }}>
            {show(section.eyebrow) && edit('eyebrow', '작은 문구', S.heroEyebrow)}
            {gap(14)}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 22, flexWrap: 'wrap', padding: `0 ${SIDE}px` }}>
              {show(section.headline) && edit('headline', '제목', S.heroTitle)}
              {show(section.headlineAccent) && edit('headlineAccent', '제목 강조', { ...S.heroTitle, color: accent })}
            </div>
            {photos.length > 0 && (
              <div style={{ padding: `50px ${SIDE + 30}px 0` }}>{photoRun(section, photos, 18, 0)}</div>
            )}
            {gap(60)}
            {stats.length > 0 && (
              <div style={{ background: accent, display: 'flex', padding: '44px 20px' }}>
                {stats.map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      flex: 1, minWidth: 0, padding: '0 12px',
                      borderLeft: idx === 0 ? 'none' : '2px solid rgba(255,255,255,0.35)',
                    }}
                  >
                    {editHighlight(idx, 'icon', '🔥', S.statIcon)}
                    {gap(14)}
                    {editHighlight(idx, 'title', '장점', S.statTitle)}
                    {editHighlight(idx, 'desc', '값', S.statValue)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // 공감: 강조색 질문 → 검정 맺음 → 좌우 번갈아 말풍선 → 마무리 두 줄 → 사진.
      case 'gChat': {
        const items = section.items || [];
        return (
          <div style={{ paddingTop: 100 }}>
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.headline) && edit('headline', '질문', { ...S.title, color: accent })}
              {show(section.headlineAccent) && edit('headlineAccent', '질문 끝', S.title)}
            </div>
            {gap(60)}
            {items.map((item, idx) => {
              if (!item.trim() && !blank) return null;
              const right = idx % 2 === 1;
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: right ? 'flex-end' : 'flex-start', padding: `0 ${SIDE + 20}px`, marginBottom: 34 }}>
                  <div style={{ position: 'relative', background: accent, borderRadius: 22, padding: '22px 36px', maxWidth: 600 }}>
                    <EditableText
                      value={item}
                      onChange={v => {
                        const next = [...items];
                        next[idx] = v;
                        updateSection(section.id, { items: next });
                      }}
                      placeholder="말풍선"
                      style={S.bubble}
                    />
                    <div
                      style={{
                        position: 'absolute', bottom: -16, [right ? 'right' : 'left']: 40,
                        width: 0, height: 0,
                        borderTop: `18px solid ${accent}`,
                        borderLeft: '12px solid transparent', borderRight: '12px solid transparent',
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {gap(50)}
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.noticeTitle) && edit('noticeTitle', '마무리', { ...S.sub, color: accent })}
              {show(section.noticeSubtitle) && edit('noticeSubtitle', '마무리 끝', S.sub)}
            </div>
            {gap(photos.length ? 50 : 100)}
            {photoRun(section, photos, 18, 0)}
          </div>
        );
      }

      case 'gTitle':
        return (
          <div style={{ paddingTop: 100 }}>
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.eyebrow) && edit('eyebrow', '작은 문구', { ...S.eyebrow, color: accent })}
              {gap(12)}
              {show(section.headline) && edit('headline', '제목', S.title)}
              {section.body?.trim() && <>{gap(20)}{edit('body', '설명', S.body)}</>}
            </div>
            {gap(photos.length ? 50 : 100)}
            {photoRun(section, photos, 18, 0)}
          </div>
        );

      // 비교: 머리글 두 개 → 동그란 사진 두 장 → [회색 칸 | 가운데 흰 원 라벨 | 강조색 칸] 줄들.
      case 'gCompare': {
        const rows = section.rows || [];
        const updateRow = (idx: number, patch: Partial<{ label: string; value: string; other: string }>) => {
          const next = [...rows];
          next[idx] = { ...next[idx], ...patch };
          updateSection(section.id, { rows: next });
        };
        const PILL = 130;
        return (
          <div style={{ padding: `90px 50px 90px` }}>
            <div style={{ display: 'flex' }}>
              <div style={{ flex: 1 }}>{show(section.compareLeft) && edit('compareLeft', '비교 대상', { ...S.compareHead, color: GRAY_TEXT })}</div>
              <div style={{ flex: 1 }}>{show(section.compareRight) && edit('compareRight', '우리 제품', { ...S.compareHead, color: accent })}</div>
            </div>
            {gap(26)}
            {(photos.length > 0 || blank) && (
              <div style={{ display: 'flex', marginBottom: -60, position: 'relative', zIndex: 1 }}>
                {[0, 1].map(i => (
                  <div key={i} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <PhotoBox photo={photos[i]} size={260} round style={{ border: '8px solid #ffffff', boxShadow: '0 6px 18px rgba(0,0,0,0.12)' }} />
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', position: 'relative' }}>
              <div style={{ flex: 1, background: COMPARE_GRAY, borderRadius: '24px 0 0 0', paddingTop: photos.length > 0 || blank ? 70 : 10 }} />
              <div style={{ flex: 1, background: accent, borderRadius: '0 24px 0 0', paddingTop: photos.length > 0 || blank ? 70 : 10 }} />
            </div>
            {rows.map((row, idx) => {
              if (!blank && !row.label.trim() && !row.value.trim() && !(row.other || '').trim()) return null;
              const last = idx === rows.length - 1;
              return (
                <div key={idx} style={{ display: 'flex', position: 'relative', alignItems: 'stretch' }}>
                  <div style={{ flex: 1, background: COMPARE_GRAY, padding: `30px ${PILL / 2 + 24}px 30px 24px`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '2px solid rgba(255,255,255,0.25)', borderRadius: last ? '0 0 0 24px' : 0 }}>
                    <EditableText value={row.other || ''} onChange={v => updateRow(idx, { other: v })} placeholder="아쉬운 점" style={S.compareCell} />
                  </div>
                  <div style={{ flex: 1, background: accent, padding: `30px 24px 30px ${PILL / 2 + 24}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '2px solid rgba(255,255,255,0.25)', borderRadius: last ? '0 0 24px 0' : 0 }}>
                    <EditableText value={row.value} onChange={v => updateRow(idx, { value: v })} placeholder="좋은 점" style={S.compareCell} />
                  </div>
                  <div
                    style={{
                      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                      width: PILL, height: PILL, borderRadius: '50%', background: '#ffffff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, boxSizing: 'border-box',
                    }}
                  >
                    <EditableText value={row.label} onChange={v => updateRow(idx, { label: v })} placeholder="항목" style={S.comparePill} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      // 체크포인트: 번호는 체크포인트 섹션 순서에서 자동으로 붙는다(지우거나 옮겨도 안 어긋나게).
      case 'gCheck':
        return (
          <div style={{ paddingTop: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ ...S.checkLabel, color: accent, borderBottom: `3px solid ${accent}`, paddingBottom: 6 }}>
                Check Point. {checkNumber}
              </div>
            </div>
            {gap(30)}
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.headline) && edit('headline', '제목', S.title)}
              {show(section.headlineAccent) && edit('headlineAccent', '제목 강조', { ...S.title, color: accent })}
              {show(section.body) && <>{gap(22)}{edit('body', '설명', S.body)}</>}
            </div>
            {gap(photos.length ? 50 : 100)}
            {photoRun(section, photos, 18, 0)}
          </div>
        );

      // 인증: 강조색 바탕에 흰 글씨. 첫 사진은 동그란 로고, 나머지는 흰 테두리 인증서로 나란히.
      case 'gCert': {
        const [logo, ...docs] = photos;
        return (
          <div style={{ padding: '90px 0 100px', background: section.backgroundColor ? undefined : accent }}>
            {(logo || blank) && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
                <PhotoBox photo={logo} size={190} round contain style={{ border: '6px solid #ffffff' }} />
              </div>
            )}
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.headline) && edit('headline', '제목', { ...S.title, color: '#ffffff' })}
              {show(section.body) && <>{gap(22)}{edit('body', '설명', { ...S.body, color: '#ffffff', opacity: 0.92 })}</>}
            </div>
            {docs.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 30, padding: `60px ${SIDE}px 0` }}>
                {docs.map(photo => (
                  <div key={photo.id} style={{ flex: 1, maxWidth: 320, background: '#ffffff', padding: 14, boxShadow: '0 8px 20px rgba(0,0,0,0.18)' }}>
                    {renderPhoto(photo, 0)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // 활용법: 제목 두 줄 → [왼쪽 네모 사진 | 번호·제목·설명] 단계들. 사진은 위에서부터 단계에 한 장씩.
      case 'gSteps': {
        const steps = section.highlights || [];
        const extra = photos.slice(steps.length);
        return (
          <div style={{ padding: '100px 0 90px' }}>
            <div style={{ padding: `0 ${SIDE}px` }}>
              {show(section.headline) && edit('headline', '제목', S.title)}
              {show(section.headlineAccent) && edit('headlineAccent', '제목 강조', { ...S.title, color: accent })}
            </div>
            {gap(56)}
            {steps.map((step, idx) => {
              if (!blank && !step.title.trim() && !step.desc.trim() && !photos[idx]) return null;
              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 36, padding: `0 ${SIDE}px`, marginBottom: 30 }}>
                  <PhotoBox photo={photos[idx]} size={290} radius={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ ...S.stepTitle, color: accent, flexShrink: 0 }}>{idx + 1}.</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {editHighlight(idx, 'title', '단계 이름', { ...S.stepTitle, color: accent })}
                      </div>
                    </div>
                    {gap(10)}
                    {editHighlight(idx, 'desc', '설명', S.stepDesc)}
                  </div>
                </div>
              );
            })}
            {extra.length > 0 && <div style={{ paddingTop: 30 }}>{photoRun(section, extra, 18, 0)}</div>}
          </div>
        );
      }

      // 구성: 흰 상자 안 제품 사진, 그 아래쪽 테두리에 걸친 강조색 알약, 작은 안내.
      case 'gPackage':
        return (
          <div style={{ padding: `90px ${SIDE + 10}px 90px` }}>
            <div style={{ background: '#ffffff', borderRadius: 28, padding: `40px 40px ${show(section.bigText) ? 70 : 40}px`, boxShadow: `0 6px 20px ${kimchiTint(accent, 0.15)}` }}>
              {photos.length > 0 ? photoRun(section, photos, 18, 0) : blank ? <div style={{ height: 300 }} /> : null}
            </div>
            {show(section.bigText) && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: -40 }}>
                <div style={{ background: accent, borderRadius: 999, padding: '20px 44px', position: 'relative' }}>
                  {edit('bigText', '구성 (예: 500g x 5팩)', S.pill)}
                </div>
              </div>
            )}
            {show(section.body) && <>{gap(30)}{edit('body', '안내', S.body)}</>}
          </div>
        );

      // 제품 상세 정보: 가운데 제목 + 위 굵은 선 표.
      case 'pairs': {
        const rows = section.rows || [];
        return (
          <div style={{ padding: `100px ${SIDE}px 90px` }}>
            {section.title.trim() && (
              <>
                <EditableText value={section.title} onChange={v => updateSection(section.id, { title: v })} placeholder="제목" style={S.title} />
                {gap(44)}
              </>
            )}
            <div style={{ borderTop: `3px solid ${textColor}` }}>
              {rows.map((row, idx) => {
                if (!blank && !row.value.trim()) return null;
                const updateRow = (patch: Partial<{ label: string; value: string }>) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], ...patch };
                  updateSection(section.id, { rows: next });
                };
                return (
                  <div key={idx} style={{ display: 'flex', borderBottom: `1px solid ${TABLE_LINE}` }}>
                    <div style={{ width: 230, flexShrink: 0, background: TABLE_LABEL_BG, padding: '20px 22px' }}>
                      <EditableText value={row.label} onChange={v => updateRow({ label: v })} placeholder="항목" style={S.tableLabel} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, padding: '20px 24px' }}>
                      <EditableText value={row.value} onChange={v => updateRow({ value: v })} placeholder="내용" style={S.tableValue} />
                    </div>
                  </div>
                );
              })}
            </div>
            {photos.length > 0 && <div style={{ paddingTop: 50 }}>{photoRun(section, photos, 18, 0)}</div>}
          </div>
        );
      }

      // 김치 틀 종류가 섞여 들어온 경우엔 사진만 보여준다.
      default:
        return photoRun(section, photos, 18, 0);
    }
  };

  let checkCount = 0;
  return (
    <>
      {sections.map(section => {
        const photos = photosBySection[section.id] || [];
        const isEmpty = !kimchiSectionHasText(section) && photos.length === 0;
        const checkNumber = section.kind === 'gCheck' ? ++checkCount : 0;
        return (
          <div
            key={section.id}
            data-section-id={section.id}
            data-empty-section={isEmpty ? 'true' : undefined}
            style={{ marginBottom: section.sectionGap ?? 0, background: section.backgroundColor || undefined }}
          >
            {renderBody(section, photos, checkNumber)}
          </div>
        );
      })}
    </>
  );
};

export default GreenPreview;
