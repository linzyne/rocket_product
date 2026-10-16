import React from 'react';
import EditableText from './EditableText';
import { KimchiTypeScale, kimchiTint } from './KimchiDetailSections';
import { KimchiSection } from '../utils/kimchiDetailTemplate';

// 안내사항 섹션('notes') — 상품마다 다른 주의·안내 문구 목록. 어느 틀이든 에디터가 이걸로 그린다.
// 디자인 A 상자 / B 번호줄 / C 띠는 섹션의 guideDesign으로 고른다. 빈 줄은 저장 이미지에서 빠진다.

interface NotesSectionProps {
  section: KimchiSection;
  updateSection: (id: string, patch: Partial<KimchiSection>) => void;
  fontFamily: string;
  textColor: string;
  fontScale: number;
  typeScale: KimchiTypeScale;
  accentColor: string;
}

const SIDE = 70;
const GRAY = '#5f5f5f';

const NotesSection: React.FC<NotesSectionProps> = ({ section, updateSection, fontFamily, textColor, fontScale, typeScale, accentColor }) => {
  const accent = section.accentColor || accentColor;
  const px = (v: number) => Math.round(v * fontScale);
  const small = typeScale.caption * 0.8;
  const t = (size: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily, color: textColor, fontSize: px(size), lineHeight: 1.45, whiteSpace: 'pre-line', ...extra,
  });
  const items = section.items || [];
  const blank = !items.some(i => i.trim());
  // 미리보기에선 빈 줄도 보여줘야 눌러서 채울 수 있다. 하나라도 채웠으면 빈 줄은 감춘다.
  const visible = items.map((text, idx) => ({ text, idx })).filter(({ text }) => blank || text.trim());
  const editItem = (idx: number, style: React.CSSProperties) => (
    <EditableText
      value={items[idx] || ''}
      onChange={v => {
        const next = [...items];
        next[idx] = v;
        updateSection(section.id, { items: next });
      }}
      placeholder="안내 문구"
      style={style}
    />
  );
  const title = (style: React.CSSProperties) => (
    <EditableText value={section.title} onChange={v => updateSection(section.id, { title: v })} placeholder="안내사항" style={style} />
  );
  const caption = (style: React.CSSProperties) => (
    <EditableText value={section.caption} onChange={v => updateSection(section.id, { caption: v })} placeholder="NOTICE" style={style} />
  );
  const itemStyle = t(small * 0.85, { color: GRAY, lineHeight: 1.6 });
  const design = section.guideDesign ?? 'A';

  // A 상자: 옅은 강조색 상자 안에 느낌표 동그라미 + 제목, 점 목록.
  if (design === 'A') {
    return (
      <div style={{ padding: `80px ${SIDE}px` }}>
        <div style={{ background: kimchiTint(accent, 0.07), border: `2px solid ${kimchiTint(accent, 0.25)}`, borderRadius: 28, padding: '50px 50px 44px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 30 }}>
            <div style={{
              width: px(48), height: px(48), borderRadius: '50%', background: accent, color: '#ffffff', flexShrink: 0,
              fontFamily, fontWeight: 900, fontSize: px(28), display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>!</div>
            {title(t(typeScale.heading * 0.7, { fontWeight: 800 }))}
          </div>
          {visible.map(({ idx }) => (
            <div key={idx} style={{ display: 'flex', gap: 16, marginTop: 14 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0, marginTop: px(16) }} />
              <div style={{ flex: 1, minWidth: 0 }}>{editItem(idx, itemStyle)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // B 번호줄: 왼쪽 정렬 영문 캡션 + 제목, 굵은 선 아래 01·02 번호와 가는 선.
  if (design === 'B') {
    return (
      <div style={{ padding: `80px ${SIDE}px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 36, height: 3, background: accent }} />
          {caption(t(small * 0.7, { fontWeight: 800, letterSpacing: '0.18em', color: accent }))}
        </div>
        {title(t(typeScale.heading * 0.8, { fontWeight: 800 }))}
        <div style={{ height: 30, borderBottom: `3px solid ${textColor}` }} />
        {visible.map(({ idx }, i) => (
          <div key={idx} style={{ display: 'flex', gap: 24, padding: '24px 0', borderBottom: '1px solid #dedede' }}>
            <div style={{ fontFamily, fontWeight: 900, fontSize: px(26), color: accent, flexShrink: 0, lineHeight: 1.6 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{editItem(idx, itemStyle)}</div>
          </div>
        ))}
      </div>
    );
  }

  // C 띠: 강조색 머리띠에 흰 제목, 아래 흰 카드마다 ✓.
  return (
    <div>
      <div style={{ background: accent, padding: `40px ${SIDE}px 36px`, textAlign: 'center' }}>
        {caption(t(small * 0.7, { fontWeight: 800, letterSpacing: '0.18em', color: '#ffffff', opacity: 0.8, textAlign: 'center' }))}
        <div style={{ height: 8 }} />
        {title(t(typeScale.heading * 0.8, { fontWeight: 800, color: '#ffffff', textAlign: 'center' }))}
      </div>
      <div style={{ background: kimchiTint(accent, 0.06), padding: `44px ${SIDE}px 70px` }}>
        {visible.map(({ idx }) => (
          <div key={idx} style={{ display: 'flex', gap: 18, alignItems: 'flex-start', background: '#ffffff', borderRadius: 20, padding: '26px 30px', marginTop: 14 }}>
            <div style={{
              width: px(36), height: px(36), borderRadius: '50%', border: `3px solid ${accent}`, color: accent, flexShrink: 0,
              fontFamily, fontWeight: 900, fontSize: px(18), display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
            }}>✓</div>
            <div style={{ flex: 1, minWidth: 0 }}>{editItem(idx, { ...itemStyle, color: textColor })}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotesSection;
