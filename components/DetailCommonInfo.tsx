import React, { useCallback, useEffect, useState } from 'react';
import EditableText from './EditableText';
import { KimchiTypeScale, kimchiTint } from './KimchiDetailSections';

// 모든 틀(김치·초록·앞으로 생길 틀)에 똑같이 들어가는 공통 안내.
//  - 주문 마감(오늘 출발 10:00 + 안내 두 줄): 인트로 바로 아래
//  - 배송·교환반품 / CS 접수 / FAQ: 페이지 아래쪽, 제품 상세 정보(표시사항) 바로 위
// 섹션이 아니라 미리보기가 섹션들 사이에 끼워 그리는 고정 블록이다 — 그래서 섹션 종류를 늘리지 않고,
// 새 틀을 만들어도 따로 챙길 것 없이 저절로 붙는다(DetailPageBuilderModal의 splitForCommonInfo).
// 문구와 디자인은 카테고리마다 따로다(김치 / 고등어 …). 같은 카테고리 안의 상페들은 함께 쓰고,
// 미리보기에서 고치면 그 카테고리 상페 전부에 같이 바뀐다. 디자인은 A·B·C 세 가지 — 모양뿐 아니라
// 블록 순서도 다르다(COMMON_ORDER). 새 카테고리는 앞 카테고리와 겹치지 않게 자동으로 하나가 잡힌다.

export type CommonDesign = 'A' | 'B' | 'C';
export const COMMON_DESIGNS: { id: CommonDesign; label: string; hint: string }[] = [
  { id: 'A', label: 'A 카드', hint: '둥근 카드 · 배송 → FAQ → 반품 → CS' },
  { id: 'B', label: 'B 라인', hint: '왼쪽 정렬 · 가는 선 · FAQ → 배송 → 반품 → CS' },
  { id: 'C', label: 'C 띠', hint: '강조색 머리띠 · CS → FAQ → 배송 → 반품' },
];

export interface CommonInfo {
  design?: CommonDesign;
  deadline: { icon: string; title: string; subtitle: string; big: string; cards: string[] };
  shipping: { caption: string; title: string; rows: { label: string; value: string }[] };
  refund: { caption: string; title: string; lead: string; items: { title: string; body: string }[] };
  cs: { caption: string; title: string; lead: string; photoTitle: string; photos: string[]; warning: string; contactTitle: string; phone: string; contactNote: string };
  faq: { caption: string; title: string; subtitle: string; items: { q: string; a: string }[] };
}

export const KIMCHI_COMMON_INFO: CommonInfo = {
  deadline: {
    icon: '🚚',
    title: '오늘 출발',
    subtitle: '오전 10시까지 주문시',
    big: '10:00',
    cards: [
      '오전 10시 이후 제조 및 출고 시작으로\n주문취소 및 주문수정이 불가하오니\n신중 구매 부탁드립니다.',
      '산지 상황에 따라 도착예정일보다\n지연되거나 빨리 도착할 수 있으니\n신중 구매 부탁드립니다.',
    ],
  },
  shipping: {
    caption: 'SHIPPING',
    title: '배송 안내',
    rows: [
      { label: '배송일', value: '월요일~금요일 (당일출고)\n산지 사정으로 1~2일 지연이나 단축될 수 있습니다.' },
      { label: '배송비', value: '무료배송' },
      { label: '출고 마감', value: '평일 오전 10시 전 접수 시 당일 출고\n10시 이후 주문변경·취소 불가' },
      { label: '도착', value: '주문 기준 1~3일 이내 받아보실 수 있습니다.\n택배사 사정·기상악화·주문 폭주 시 지연될 수 있습니다.' },
      { label: '휴무', value: '토요일·일요일·법정공휴일\n금요일 오전 10시 이후 주문은 월요일에 발송합니다.' },
    ],
  },
  refund: {
    caption: 'RETURN',
    title: '교환 및 반품 안내',
    lead: '본 제품에 이상이 있을 경우 공정거래위원회에서 고시한 소비자분쟁해결기준에 의해 보상해드립니다.\n상품 특성상 아래의 경우에는 교환 및 반품이 어려운 점 양해 부탁드립니다.',
    items: [
      { title: '단순 변심 및 개인 사유', body: '주문 과정에서의 실수, 수령일 착오, 보관상의 부주의 또는 국물의 양·맛·모양·크기 등 개인의 주관적인 판단에 따른 교환 및 반품은 불가합니다.' },
      { title: '배송지 정보 오류 및 수령인 부재', body: '수취인 불명, 잘못된 연락처 또는 주소 입력, 수령인 부재 등의 사유로 상품이 반송되는 경우 발생하는 왕복 배송비는 구매자 부담입니다.' },
      { title: '배송 중 포장 상태', body: '배송 중 약간의 국물 누수나 포장 형태의 변형이 발생할 수 있습니다. 제품 자체에 이상이 없는 경우 교환 및 반품 사유에 해당하지 않습니다.' },
      { title: '신청 기간', body: '상품 수령 후 3일이 지났거나 상품을 1/4 이상 섭취한 경우 제품 상태 확인이 어려워 교환 및 반품이 불가합니다.' },
      { title: '아이스팩', body: '계절 및 기온의 영향으로 아이스팩이 녹은 상태로 도착할 수 있습니다. 아이스팩이 녹았다는 이유만으로 환불은 어렵습니다.' },
      { title: '상품 이상 발생 시', body: '상품에 이상이 확인되는 경우 소비자분쟁해결기준에 따라 적절한 보상을 진행해 드립니다. 배송 완료 후 24시간 이내 문자로 문의해 주세요.' },
      { title: '부정·불량식품 신고', body: '부정·불량식품 신고는 국번 없이 1399로 연락해 주세요.' },
    ],
  },
  cs: {
    caption: 'CS CENTER',
    title: 'CS 접수 안내',
    lead: '반품·환불 요청 시 사진이 꼭 필요하며,\n고객님 임의로 폐기 및 반송하시면 처리가 어렵습니다.',
    photoTitle: '꼭 보내주실 사진 3장',
    photos: ['송장이 보이는\n박스 사진', '문제가 되는\n부위 사진', '제품\n전체 사진'],
    warning: '사진이 없으면 상품 상태 확인이 어려워 접수가 불가합니다.',
    contactTitle: '접수 연락처',
    phone: '010-4862-9452',
    contactNote: '문자로 보내주시면 순서대로 답변드리고 처리해드립니다.',
  },
  faq: {
    caption: 'FAQ',
    title: '자주 묻는 질문',
    subtitle: '구매 전 꼭 확인해 주세요',
    items: [
      { q: '짜요, 싱거워요, 달아요, 맛이 없어요, 냄새나요.', a: '개인의 주관적인 기호나 취향, 익힘 정도에 따른 사유로는 교환 및 환불이 어렵습니다.' },
      { q: '익어서 도착했어요.', a: '김치는 생물 발효식품으로 배송 중 온도와 도착 시간, 수령 환경에 따라 숙성도가 조금씩 달라질 수 있습니다. 모든 제품은 당일 제조하여 출고하며, 배송 중 자연스럽게 생긴 숙성에 따른 교환 및 환불은 어렵습니다.' },
      { q: '국물이 새었어요.', a: '배송 중 흔들림이나 압력, 온도 변화로 국물이 일부 새거나 포장에 흔적이 생길 수 있습니다. 제품 자체에 이상이 없는 경우 교환 및 환불은 어렵습니다.' },
      { q: '아이스팩이 녹았어요.', a: '배송 중 아이스팩이 녹는 것은 자연스러운 현상으로, 그것만으로 품질에 이상이 있다고 보기는 어렵습니다. 아이스팩이 녹았다는 사유만으로 교환 및 환불은 어렵습니다.' },
    ],
  },
};

// 김치가 아닌 카테고리의 처음 문구 — 김치·국물 이야기를 뺀 일반 식품용.
export const GENERIC_COMMON_INFO: CommonInfo = {
  ...KIMCHI_COMMON_INFO,
  refund: {
    ...KIMCHI_COMMON_INFO.refund,
    items: [
      { title: '단순 변심 및 개인 사유', body: '주문 과정에서의 실수, 수령일 착오, 보관상의 부주의 또는 맛·모양·크기 등 개인의 주관적인 판단에 따른 교환 및 반품은 불가합니다.' },
      { title: '배송지 정보 오류 및 수령인 부재', body: '수취인 불명, 잘못된 연락처 또는 주소 입력, 수령인 부재 등으로 상품이 반송되는 경우 왕복 배송비는 구매자 부담입니다.' },
      { title: '신청 기간', body: '상품 수령 후 3일이 지났거나 이미 드신 경우 제품 상태 확인이 어려워 교환 및 반품이 불가합니다.' },
      { title: '상품 이상 발생 시', body: '배송 완료 후 24시간 이내 사진과 함께 문자로 알려주시면 소비자분쟁해결기준에 따라 보상해 드립니다.' },
      { title: '부정·불량식품 신고', body: '부정·불량식품 신고는 국번 없이 1399로 연락해 주세요.' },
    ],
  },
  faq: {
    ...KIMCHI_COMMON_INFO.faq,
    items: [
      { q: '언제 받아볼 수 있나요?', a: '평일 오전 10시 전 주문은 당일 출고되어 보통 1~3일 안에 받아보실 수 있습니다.' },
      { q: '맛이 생각했던 것과 달라요.', a: '개인의 기호나 취향에 따른 사유로는 교환 및 환불이 어렵습니다.' },
      { q: '상자가 찌그러져서 왔어요.', a: '배송 중 상자가 눌릴 수 있습니다. 제품 자체에 이상이 없는 경우 교환 및 환불은 어렵습니다.' },
      { q: '아이스팩이 녹았어요.', a: '배송 중 아이스팩이 녹는 것은 자연스러운 현상으로, 그 사유만으로 교환 및 환불은 어렵습니다.' },
    ],
  },
};

const KEY_PREFIX = 'detailCommonInfo:';
// 카테고리별로 나누기 전에 쓰던 하나뿐인 저장본. 김치 카테고리는 이걸 그대로 이어받고,
// 다른 카테고리는 연락처만 가져간다(전화번호는 어느 카테고리든 같을 테니).
const LEGACY_KEY = 'detailCommonInfo';
const CHANGE_EVENT = 'detail-common-info-change';

const readJson = (key: string) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};

const mergeInfo = (base: CommonInfo, saved: Partial<CommonInfo> | null): CommonInfo => {
  if (!saved || typeof saved !== 'object') return base;
  // 나중에 칸이 늘어도 예전 저장본이 깨지지 않게 묶음별로 기본값 위에 덮는다.
  const merged = { ...base } as Record<string, unknown>;
  for (const key of ['deadline', 'shipping', 'refund', 'cs', 'faq'] as const) {
    if (saved[key]) merged[key] = { ...base[key], ...saved[key] };
  }
  if (saved.design) merged.design = saved.design;
  return merged as unknown as CommonInfo;
};

const loadCommonInfo = (categoryId: string, fallbackDesign: CommonDesign): CommonInfo => {
  const own = readJson(KEY_PREFIX + categoryId);
  const legacy = readJson(LEGACY_KEY) as Partial<CommonInfo> | null;
  const base = categoryId === 'kimchi'
    ? mergeInfo(KIMCHI_COMMON_INFO, legacy)
    : legacy?.cs ? { ...GENERIC_COMMON_INFO, cs: { ...GENERIC_COMMON_INFO.cs, ...legacy.cs } } : GENERIC_COMMON_INFO;
  const info = mergeInfo(base, own);
  return { ...info, design: own?.design ?? fallbackDesign };
};

// 카테고리 순서로 디자인을 돌려 준다 — 김치 A, 다음 B, 다음 C, 다시 A …
export const defaultCommonDesign = (categoryIndex: number): CommonDesign =>
  (['A', 'B', 'C'] as const)[Math.max(0, categoryIndex) % 3];

// 같은 카테고리를 연 다른 에디터(상품 탭 등)도 같은 값을 보도록 고칠 때 알린다.
export const useCommonInfo = (categoryId: string, fallbackDesign: CommonDesign) => {
  const [info, setInfo] = useState<CommonInfo>(() => loadCommonInfo(categoryId, fallbackDesign));
  useEffect(() => {
    setInfo(loadCommonInfo(categoryId, fallbackDesign));
    const sync = () => setInfo(loadCommonInfo(categoryId, fallbackDesign));
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, [categoryId, fallbackDesign]);
  const save = useCallback((next: CommonInfo) => {
    try { localStorage.setItem(KEY_PREFIX + categoryId, JSON.stringify(next)); } catch { /* 이번 화면에만 반영 */ }
    setInfo(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [categoryId]);
  const update = useCallback(<K extends 'deadline' | 'shipping' | 'refund' | 'cs' | 'faq'>(key: K, patch: Partial<CommonInfo[K]>) => {
    const next = { ...loadCommonInfo(categoryId, fallbackDesign) };
    next[key] = { ...next[key], ...patch };
    save(next);
  }, [categoryId, fallbackDesign, save]);
  const setDesign = useCallback((design: CommonDesign) => {
    save({ ...loadCommonInfo(categoryId, fallbackDesign), design });
  }, [categoryId, fallbackDesign, save]);
  return [info, update, setDesign] as const;
};

interface CommonBlockProps {
  info: CommonInfo;
  update: ReturnType<typeof useCommonInfo>[1];
  fontFamily: string;
  textColor: string;
  fontScale: number;
  typeScale: KimchiTypeScale;
  accentColor: string;
}

const SIDE = 70;
const GRAY = '#6b6b6b';

const useStyles = ({ fontFamily, textColor, fontScale, typeScale }: CommonBlockProps) => {
  const px = (v: number) => Math.round(v * fontScale);
  const small = typeScale.caption * 0.8;
  const t = (size: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily, color: textColor, fontSize: px(size), lineHeight: 1.4, textAlign: 'center', whiteSpace: 'pre-line', ...extra,
  });
  return {
    px,
    caption: t(small * 0.75, { fontWeight: 800, letterSpacing: '0.18em' }),
    title: t(typeScale.heading * 0.85, { fontWeight: 800, lineHeight: 1.25 }),
    subtitle: t(small * 0.9, { fontWeight: 500, color: GRAY }),
    body: t(small * 0.82, { fontWeight: 400, lineHeight: 1.6, color: GRAY, textAlign: 'left' }),
    bodyCenter: t(small * 0.82, { fontWeight: 400, lineHeight: 1.6, color: GRAY }),
    strong: t(small * 0.9, { fontWeight: 800, textAlign: 'left' }),
    label: t(small * 0.8, { fontWeight: 800, textAlign: 'left' }),
    big: t(typeScale.display, { fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.02em' }),
    deadlineTitle: t(typeScale.title * 0.7, { fontWeight: 900, lineHeight: 1.15 }),
    deadlineCard: t(small * 0.85, { fontWeight: 500, lineHeight: 1.6 }),
    icon: t(typeScale.heading, { lineHeight: 1 }),
  };
};

// 배열 안 한 칸을 고치는 EditableText.
const editAt = <L extends unknown[]>(list: L, idx: number, patch: (item: L[number], v: string) => L[number], save: (next: L) => void) =>
  (v: string) => {
    const next = [...list] as L;
    next[idx] = patch(next[idx], v);
    save(next);
  };

// 오늘 출발: 강조색 테두리 카드 안에 아이콘 → 제목 → 부제 → 큰 시각, 아래로 안내 두 줄을 칸으로 나눈다.
const DeadlineA: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor } = props;
  const S = useStyles(props);
  const d = info.deadline;
  const set = (patch: Partial<CommonInfo['deadline']>) => update('deadline', patch);
  return (
    <div style={{ padding: `90px ${SIDE}px` }}>
      <div style={{ border: `4px solid ${accentColor}`, borderRadius: 36, overflow: 'hidden', background: '#ffffff' }}>
        <div style={{ padding: '60px 40px 50px', background: kimchiTint(accentColor, 0.07) }}>
          <EditableText value={d.icon} onChange={v => set({ icon: v })} placeholder="아이콘" style={S.icon} />
          <div style={{ height: 24 }} />
          <EditableText value={d.title} onChange={v => set({ title: v })} placeholder="제목" style={S.deadlineTitle} />
          <div style={{ height: 12 }} />
          <EditableText value={d.subtitle} onChange={v => set({ subtitle: v })} placeholder="부제" style={S.subtitle} />
          <div style={{ height: 30 }} />
          <EditableText value={d.big} onChange={v => set({ big: v })} placeholder="10:00" style={{ ...S.big, color: accentColor }} />
        </div>
        {d.cards.map((card, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '36px 46px', borderTop: `2px solid ${kimchiTint(accentColor, 0.25)}` }}>
            <div style={{
              width: S.px(46), height: S.px(46), flexShrink: 0, borderRadius: '50%', background: accentColor,
              color: '#ffffff', fontFamily: props.fontFamily, fontWeight: 800, fontSize: S.px(24),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>!</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EditableText
                value={card}
                onChange={editAt(d.cards, idx, (_, v) => v, cards => set({ cards }))}
                placeholder="안내 문구"
                style={{ ...S.deadlineCard, textAlign: 'left' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// 블록 머리: 강조색 작은 영문 → 큰 제목 → (부제) → 짧은 강조색 막대.
const BlockHead: React.FC<{ S: ReturnType<typeof useStyles>; accent: string; caption?: string; title: string; subtitle?: string;
  onCaption?: (v: string) => void; onTitle: (v: string) => void; onSubtitle?: (v: string) => void }> = ({ S, accent, caption, title, subtitle, onCaption, onTitle, onSubtitle }) => (
  <div style={{ marginBottom: 56 }}>
    {caption !== undefined && onCaption && (
      <>
        <EditableText value={caption} onChange={onCaption} placeholder="CAPTION" style={{ ...S.caption, color: accent }} />
        <div style={{ height: 14 }} />
      </>
    )}
    <EditableText value={title} onChange={onTitle} placeholder="제목" style={S.title} />
    {subtitle !== undefined && onSubtitle && (
      <>
        <div style={{ height: 14 }} />
        <EditableText value={subtitle} onChange={onSubtitle} placeholder="부제" style={S.subtitle} />
      </>
    )}
    <div style={{ width: 56, height: 6, borderRadius: 3, background: accent, margin: '30px auto 0' }} />
  </div>
);

// 배송 / FAQ / 교환반품 / CS 접수 블록. 제품 상세 정보 바로 위에 들어간다.
const GuidesA: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor: accent } = props;
  const S = useStyles(props);
  const { shipping, refund, cs, faq } = info;
  const tint = (a: number) => kimchiTint(accent, a);

  return (
    <div>
      {/* 배송 안내: 왼쪽 강조색 라벨 칩 | 오른쪽 내용, 줄마다 옅은 선 */}
      <div style={{ padding: `100px ${SIDE}px 70px` }}>
        <BlockHead
          S={S} accent={accent}
          caption={shipping.caption} onCaption={v => update('shipping', { caption: v })}
          title={shipping.title} onTitle={v => update('shipping', { title: v })}
        />
        {shipping.rows.map((row, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 30, alignItems: 'flex-start', padding: '28px 0', borderTop: idx === 0 ? `3px solid ${props.textColor}` : `1px solid #e3e3e3` }}>
            <div style={{ width: 170, flexShrink: 0, background: tint(0.12), borderRadius: 999, padding: '8px 0' }}>
              <EditableText
                value={row.label}
                onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, label: v }), rows => update('shipping', { rows }))}
                placeholder="항목"
                style={{ ...S.label, color: accent, textAlign: 'center' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
              <EditableText
                value={row.value}
                onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, value: v }), rows => update('shipping', { rows }))}
                placeholder="내용"
                style={{ ...S.body, color: props.textColor }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* FAQ: Q는 강조색 글자 + 굵은 질문, A는 왼쪽 강조색 세로줄 옆 회색 답 */}
      <div style={{ padding: `90px ${SIDE}px 100px`, background: tint(0.06) }}>
        <BlockHead
          S={S} accent={accent}
          caption={faq.caption} onCaption={v => update('faq', { caption: v })}
          title={faq.title} onTitle={v => update('faq', { title: v })}
          subtitle={faq.subtitle} onSubtitle={v => update('faq', { subtitle: v })}
        />
        {faq.items.map((item, idx) => (
          <div key={idx} style={{ background: '#ffffff', borderRadius: 24, padding: '36px 40px', marginBottom: idx === faq.items.length - 1 ? 0 : 20 }}>
            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
              <div style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(34), lineHeight: 1.2, color: accent, flexShrink: 0 }}>Q</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <EditableText
                  value={item.q}
                  onChange={editAt(faq.items, idx, (it, v) => ({ ...it, q: v }), items => update('faq', { items }))}
                  placeholder="질문"
                  style={S.strong}
                />
              </div>
            </div>
            <div style={{ margin: '20px 0 0 8px', paddingLeft: 30, borderLeft: `4px solid ${tint(0.4)}` }}>
              <EditableText
                value={item.a}
                onChange={editAt(faq.items, idx, (it, v) => ({ ...it, a: v }), items => update('faq', { items }))}
                placeholder="답변"
                style={S.body}
              />
            </div>
          </div>
        ))}
      </div>
      {/* 교환·반품: 옅은 바탕 위 흰 카드들, 카드 왼쪽에 큰 강조색 번호 */}
      <div style={{ padding: `90px ${SIDE}px`, background: '#f6f6f4' }}>
        <BlockHead
          S={S} accent={accent}
          caption={refund.caption} onCaption={v => update('refund', { caption: v })}
          title={refund.title} onTitle={v => update('refund', { title: v })}
        />
        <EditableText value={refund.lead} onChange={v => update('refund', { lead: v })} placeholder="안내" style={{ ...S.bodyCenter, color: props.textColor }} />
        <div style={{ height: 50 }} />
        {refund.items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 28, background: '#ffffff', borderRadius: 24, padding: '34px 38px', marginBottom: idx === refund.items.length - 1 ? 0 : 18 }}>
            <div style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(40), lineHeight: 1, color: accent, flexShrink: 0, width: S.px(52) }}>
              {String(idx + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EditableText
                value={item.title}
                onChange={editAt(refund.items, idx, (it, v) => ({ ...it, title: v }), items => update('refund', { items }))}
                placeholder="제목"
                style={S.strong}
              />
              <div style={{ height: 10 }} />
              <EditableText
                value={item.body}
                onChange={editAt(refund.items, idx, (it, v) => ({ ...it, body: v }), items => update('refund', { items }))}
                placeholder="내용"
                style={S.body}
              />
            </div>
          </div>
        ))}
      </div>

      {/* CS 접수: 사진 3장을 동그란 번호 칸으로 나란히, 아래 경고 띠, 연락처는 강조색 카드 */}
      <div style={{ padding: `100px ${SIDE}px 90px` }}>
        <BlockHead
          S={S} accent={accent}
          caption={cs.caption} onCaption={v => update('cs', { caption: v })}
          title={cs.title} onTitle={v => update('cs', { title: v })}
        />
        <EditableText value={cs.lead} onChange={v => update('cs', { lead: v })} placeholder="안내" style={{ ...S.bodyCenter, color: props.textColor }} />
        <div style={{ height: 56 }} />
        <EditableText value={cs.photoTitle} onChange={v => update('cs', { photoTitle: v })} placeholder="사진 안내 제목" style={{ ...S.strong, textAlign: 'center', color: accent }} />
        <div style={{ height: 30 }} />
        <div style={{ display: 'flex', gap: 20 }}>
          {cs.photos.map((label, idx) => (
            <div key={idx} style={{ flex: 1, minWidth: 0, border: `2px solid ${tint(0.35)}`, borderRadius: 24, padding: '34px 14px 30px', textAlign: 'center' }}>
              <div style={{
                width: S.px(64), height: S.px(64), margin: '0 auto 20px', borderRadius: '50%', background: accent,
                color: '#ffffff', fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(32),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{idx + 1}</div>
              <EditableText
                value={label}
                onChange={editAt(cs.photos, idx, (_, v) => v, photos => update('cs', { photos }))}
                placeholder="사진"
                style={{ ...S.label, textAlign: 'center', lineHeight: 1.45 }}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 26, background: '#fff1ee', borderRadius: 16, padding: '22px 30px' }}>
          <EditableText value={cs.warning} onChange={v => update('cs', { warning: v })} placeholder="경고" style={{ ...S.label, textAlign: 'center', color: '#d6402b' }} />
        </div>
        <div style={{ marginTop: 50, background: accent, borderRadius: 28, padding: '46px 40px' }}>
          <EditableText value={cs.contactTitle} onChange={v => update('cs', { contactTitle: v })} placeholder="연락처 제목" style={{ ...S.label, textAlign: 'center', color: '#ffffff', opacity: 0.85 }} />
          <div style={{ height: 12 }} />
          <EditableText value={cs.phone} onChange={v => update('cs', { phone: v })} placeholder="전화번호" style={{ ...S.title, color: '#ffffff', letterSpacing: '0.01em' }} />
          <div style={{ height: 16 }} />
          <EditableText value={cs.contactNote} onChange={v => update('cs', { contactNote: v })} placeholder="안내" style={{ ...S.bodyCenter, color: '#ffffff', opacity: 0.9 }} />
        </div>
      </div>

    </div>
  );
};

// ── B 라인: 왼쪽 정렬, 가는 선으로 나눈 신문 같은 배치. 순서 FAQ → 배송 → 반품 → CS ──

const HeadB: React.FC<{ S: ReturnType<typeof useStyles>; accent: string; caption: string; title: string;
  onCaption: (v: string) => void; onTitle: (v: string) => void }> = ({ S, accent, caption, title, onCaption, onTitle }) => (
  <div style={{ marginBottom: 44 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 40, height: 3, background: accent }} />
      <EditableText value={caption} onChange={onCaption} placeholder="CAPTION" style={{ ...S.caption, color: accent, textAlign: 'left' }} />
    </div>
    <div style={{ height: 14 }} />
    <EditableText value={title} onChange={onTitle} placeholder="제목" style={{ ...S.title, textAlign: 'left' }} />
  </div>
);

const DeadlineB: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor: accent, textColor } = props;
  const S = useStyles(props);
  const d = info.deadline;
  const set = (patch: Partial<CommonInfo['deadline']>) => update('deadline', patch);
  return (
    <div style={{ padding: `90px ${SIDE}px` }}>
      <div style={{ borderTop: `4px solid ${textColor}`, borderBottom: `1px solid #d6d6d6`, display: 'flex', alignItems: 'center', gap: 36, padding: '44px 0' }}>
        <div style={{ flexShrink: 0 }}>
          <EditableText value={d.big} onChange={v => set({ big: v })} placeholder="10:00" style={{ ...S.big, color: accent, textAlign: 'left' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #d6d6d6', paddingLeft: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <EditableText value={d.icon} onChange={v => set({ icon: v })} placeholder="아이콘" style={{ ...S.icon, fontSize: S.px(44), textAlign: 'left' }} />
            <EditableText value={d.title} onChange={v => set({ title: v })} placeholder="제목" style={{ ...S.deadlineTitle, fontSize: S.px(56), textAlign: 'left' }} />
          </div>
          <div style={{ height: 10 }} />
          <EditableText value={d.subtitle} onChange={v => set({ subtitle: v })} placeholder="부제" style={{ ...S.subtitle, textAlign: 'left' }} />
        </div>
      </div>
      {d.cards.map((card, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 28, padding: '30px 0', borderBottom: '1px solid #d6d6d6' }}>
          <div style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(30), color: accent, flexShrink: 0, lineHeight: 1.5 }}>
            {String(idx + 1).padStart(2, '0')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableText value={card} onChange={editAt(d.cards, idx, (_, v) => v, cards => set({ cards }))} placeholder="안내 문구" style={{ ...S.deadlineCard, textAlign: 'left' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const GuidesB: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor: accent, textColor } = props;
  const S = useStyles(props);
  const { shipping, refund, cs, faq } = info;
  const line = '1px solid #dedede';
  return (
    <div>
      {/* FAQ: Q. 굵은 질문 / 들여 쓴 답, 사이마다 가는 선 */}
      <div style={{ padding: `100px ${SIDE}px 70px` }}>
        <HeadB S={S} accent={accent} caption={faq.caption} onCaption={v => update('faq', { caption: v })} title={faq.title} onTitle={v => update('faq', { title: v })} />
        <div style={{ borderTop: `3px solid ${textColor}` }}>
          {faq.items.map((item, idx) => (
            <div key={idx} style={{ padding: '34px 0', borderBottom: line }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(32), color: accent, lineHeight: 1.3, flexShrink: 0 }}>Q.</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditableText value={item.q} onChange={editAt(faq.items, idx, (it, v) => ({ ...it, q: v }), items => update('faq', { items }))} placeholder="질문" style={S.strong} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                <div style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(32), color: '#b5b5b5', lineHeight: 1.3, flexShrink: 0 }}>A.</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditableText value={item.a} onChange={editAt(faq.items, idx, (it, v) => ({ ...it, a: v }), items => update('faq', { items }))} placeholder="답변" style={S.body} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 배송: 항목 이름(굵게) | 내용, 점선 */}
      <div style={{ padding: `70px ${SIDE}px` }}>
        <HeadB S={S} accent={accent} caption={shipping.caption} onCaption={v => update('shipping', { caption: v })} title={shipping.title} onTitle={v => update('shipping', { title: v })} />
        <div style={{ borderTop: `3px solid ${textColor}` }}>
          {shipping.rows.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 24, padding: '26px 0', borderBottom: '1px dashed #cfcfcf' }}>
              <div style={{ width: 160, flexShrink: 0 }}>
                <EditableText value={row.label} onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, label: v }), rows => update('shipping', { rows }))} placeholder="항목" style={S.label} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <EditableText value={row.value} onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, value: v }), rows => update('shipping', { rows }))} placeholder="내용" style={S.body} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 반품: 안내 문단 + 번호. 제목 / 내용 */}
      <div style={{ padding: `70px ${SIDE}px` }}>
        <HeadB S={S} accent={accent} caption={refund.caption} onCaption={v => update('refund', { caption: v })} title={refund.title} onTitle={v => update('refund', { title: v })} />
        <EditableText value={refund.lead} onChange={v => update('refund', { lead: v })} placeholder="안내" style={{ ...S.body, color: textColor }} />
        <div style={{ height: 30, borderBottom: `3px solid ${textColor}` }} />
        {refund.items.map((item, idx) => (
          <div key={idx} style={{ padding: '28px 0', borderBottom: line }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span style={{ fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(28), color: accent }}>{idx + 1}.</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <EditableText value={item.title} onChange={editAt(refund.items, idx, (it, v) => ({ ...it, title: v }), items => update('refund', { items }))} placeholder="제목" style={S.strong} />
              </div>
            </div>
            <div style={{ height: 8 }} />
            <EditableText value={item.body} onChange={editAt(refund.items, idx, (it, v) => ({ ...it, body: v }), items => update('refund', { items }))} placeholder="내용" style={S.body} />
          </div>
        ))}
      </div>

      {/* CS: 사진 목록은 번호 네모 줄, 연락처는 굵은 선 위 큰 번호 */}
      <div style={{ padding: `70px ${SIDE}px 100px` }}>
        <HeadB S={S} accent={accent} caption={cs.caption} onCaption={v => update('cs', { caption: v })} title={cs.title} onTitle={v => update('cs', { title: v })} />
        <EditableText value={cs.lead} onChange={v => update('cs', { lead: v })} placeholder="안내" style={{ ...S.body, color: textColor }} />
        <div style={{ height: 40 }} />
        <EditableText value={cs.photoTitle} onChange={v => update('cs', { photoTitle: v })} placeholder="사진 안내 제목" style={{ ...S.strong, color: accent }} />
        <div style={{ height: 18 }} />
        {cs.photos.map((label, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '18px 0', borderBottom: line }}>
            <div style={{
              width: S.px(44), height: S.px(44), flexShrink: 0, borderRadius: 8, border: `2px solid ${accent}`, color: accent,
              fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(24), display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{idx + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EditableText value={label} onChange={editAt(cs.photos, idx, (_, v) => v, photos => update('cs', { photos }))} placeholder="사진" style={{ ...S.label, whiteSpace: 'normal' }} />
            </div>
          </div>
        ))}
        <div style={{ height: 22 }} />
        <EditableText value={cs.warning} onChange={v => update('cs', { warning: v })} placeholder="경고" style={{ ...S.label, color: '#d6402b' }} />
        <div style={{ marginTop: 50, borderTop: `3px solid ${textColor}`, paddingTop: 30, display: 'flex', alignItems: 'baseline', gap: 26, flexWrap: 'wrap' }}>
          <EditableText value={cs.contactTitle} onChange={v => update('cs', { contactTitle: v })} placeholder="연락처 제목" style={S.label} />
          <EditableText value={cs.phone} onChange={v => update('cs', { phone: v })} placeholder="전화번호" style={{ ...S.title, color: accent, textAlign: 'left' }} />
        </div>
        <div style={{ height: 12 }} />
        <EditableText value={cs.contactNote} onChange={v => update('cs', { contactNote: v })} placeholder="안내" style={S.body} />
      </div>
    </div>
  );
};

// ── C 띠: 블록마다 강조색 머리띠, 안은 타일·말풍선. 순서 CS → FAQ → 배송 → 반품 ──

const HeadC: React.FC<{ S: ReturnType<typeof useStyles>; accent: string; caption: string; title: string;
  onCaption: (v: string) => void; onTitle: (v: string) => void }> = ({ S, accent, caption, title, onCaption, onTitle }) => (
  <div style={{ background: accent, padding: `46px ${SIDE}px 42px` }}>
    <EditableText value={caption} onChange={onCaption} placeholder="CAPTION" style={{ ...S.caption, color: '#ffffff', opacity: 0.8 }} />
    <div style={{ height: 10 }} />
    <EditableText value={title} onChange={onTitle} placeholder="제목" style={{ ...S.title, color: '#ffffff' }} />
  </div>
);

const DeadlineC: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor: accent } = props;
  const S = useStyles(props);
  const d = info.deadline;
  const set = (patch: Partial<CommonInfo['deadline']>) => update('deadline', patch);
  const white = '#ffffff';
  return (
    <div style={{ padding: `70px ${SIDE - 30}px` }}>
    <div style={{ background: accent, borderRadius: 40, padding: '70px 40px 50px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <EditableText value={d.icon} onChange={v => set({ icon: v })} placeholder="아이콘" style={{ ...S.icon, fontSize: S.px(48) }} />
        <EditableText value={d.title} onChange={v => set({ title: v })} placeholder="제목" style={{ ...S.deadlineTitle, color: white }} />
      </div>
      <div style={{ height: 14 }} />
      <EditableText value={d.subtitle} onChange={v => set({ subtitle: v })} placeholder="부제" style={{ ...S.subtitle, color: white, opacity: 0.9 }} />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '30px 0 44px' }}>
        <div style={{ background: white, borderRadius: 999, padding: '10px 60px' }}>
          <EditableText value={d.big} onChange={v => set({ big: v })} placeholder="10:00" style={{ ...S.big, color: accent }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        {d.cards.map((card, idx) => (
          <div key={idx} style={{ flex: 1, minWidth: 0, background: kimchiTint('#000000', 0.14), borderRadius: 20, padding: '30px 24px' }}>
            <EditableText value={card} onChange={editAt(d.cards, idx, (_, v) => v, cards => set({ cards }))} placeholder="안내 문구" style={{ ...S.deadlineCard, fontSize: S.px(20), color: white }} />
          </div>
        ))}
      </div>
    </div>
    </div>
  );
};

const GuidesC: React.FC<CommonBlockProps> = props => {
  const { info, update, accentColor: accent, textColor } = props;
  const S = useStyles(props);
  const { shipping, refund, cs, faq } = info;
  const tint = (a: number) => kimchiTint(accent, a);
  return (
    <div>
      {/* CS: 사진 3장을 점선으로 이은 동그라미 단계, 연락처는 강조색 테두리 상자 */}
      <HeadC S={S} accent={accent} caption={cs.caption} onCaption={v => update('cs', { caption: v })} title={cs.title} onTitle={v => update('cs', { title: v })} />
      <div style={{ padding: `60px ${SIDE}px 80px` }}>
        <EditableText value={cs.lead} onChange={v => update('cs', { lead: v })} placeholder="안내" style={{ ...S.bodyCenter, color: textColor }} />
        <div style={{ height: 44 }} />
        <EditableText value={cs.photoTitle} onChange={v => update('cs', { photoTitle: v })} placeholder="사진 안내 제목" style={{ ...S.strong, textAlign: 'center' }} />
        <div style={{ height: 30 }} />
        <div style={{ display: 'flex', position: 'relative' }}>
          <div style={{ position: 'absolute', left: '16%', right: '16%', top: S.px(60), borderTop: `3px dashed ${tint(0.5)}` }} />
          {cs.photos.map((label, idx) => (
            <div key={idx} style={{ flex: 1, minWidth: 0, textAlign: 'center', position: 'relative' }}>
              <div style={{
                width: S.px(120), height: S.px(120), margin: '0 auto 18px', borderRadius: '50%', background: tint(0.12), border: `3px solid ${accent}`,
                color: accent, fontFamily: props.fontFamily, fontWeight: 900, fontSize: S.px(44),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{idx + 1}</div>
              <EditableText value={label} onChange={editAt(cs.photos, idx, (_, v) => v, photos => update('cs', { photos }))} placeholder="사진" style={{ ...S.label, textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div style={{ height: 30 }} />
        <EditableText value={cs.warning} onChange={v => update('cs', { warning: v })} placeholder="경고" style={{ ...S.label, textAlign: 'center', color: '#d6402b' }} />
        <div style={{ marginTop: 44, border: `4px solid ${accent}`, borderRadius: 24, padding: '36px 30px' }}>
          <EditableText value={cs.contactTitle} onChange={v => update('cs', { contactTitle: v })} placeholder="연락처 제목" style={{ ...S.label, textAlign: 'center', color: accent }} />
          <div style={{ height: 8 }} />
          <EditableText value={cs.phone} onChange={v => update('cs', { phone: v })} placeholder="전화번호" style={S.title} />
          <div style={{ height: 12 }} />
          <EditableText value={cs.contactNote} onChange={v => update('cs', { contactNote: v })} placeholder="안내" style={S.bodyCenter} />
        </div>
      </div>

      {/* FAQ: 질문은 강조색 말풍선(왼쪽), 답은 회색 말풍선(오른쪽으로 들여) */}
      <HeadC S={S} accent={accent} caption={faq.caption} onCaption={v => update('faq', { caption: v })} title={faq.title} onTitle={v => update('faq', { title: v })} />
      <div style={{ padding: `60px ${SIDE}px 80px` }}>
        {faq.items.map((item, idx) => (
          <div key={idx} style={{ marginBottom: idx === faq.items.length - 1 ? 0 : 40 }}>
            <div style={{ display: 'flex' }}>
              <div style={{ maxWidth: '85%', background: tint(0.14), borderRadius: '26px 26px 26px 6px', padding: '22px 30px' }}>
                <EditableText value={item.q} onChange={editAt(faq.items, idx, (it, v) => ({ ...it, q: v }), items => update('faq', { items }))} placeholder="질문" style={{ ...S.strong, color: accent }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <div style={{ maxWidth: '88%', background: '#f1f1f1', borderRadius: '26px 26px 6px 26px', padding: '22px 30px' }}>
                <EditableText value={item.a} onChange={editAt(faq.items, idx, (it, v) => ({ ...it, a: v }), items => update('faq', { items }))} placeholder="답변" style={S.body} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 배송: 두 칸씩 놓인 타일 */}
      <HeadC S={S} accent={accent} caption={shipping.caption} onCaption={v => update('shipping', { caption: v })} title={shipping.title} onTitle={v => update('shipping', { title: v })} />
      <div style={{ padding: `60px ${SIDE}px 80px`, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {shipping.rows.map((row, idx) => (
          <div key={idx} style={{ width: 'calc(50% - 9px)', boxSizing: 'border-box', background: tint(0.07), borderRadius: 20, padding: '28px 26px' }}>
            <EditableText value={row.label} onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, label: v }), rows => update('shipping', { rows }))} placeholder="항목" style={{ ...S.label, color: accent }} />
            <div style={{ height: 10 }} />
            <EditableText value={row.value} onChange={editAt(shipping.rows, idx, (r, v) => ({ ...r, value: v }), rows => update('shipping', { rows }))} placeholder="내용" style={{ ...S.body, fontSize: S.px(22) }} />
          </div>
        ))}
      </div>

      {/* 반품: 옅은 상자 안내 + 강조색 네모 표시 목록 */}
      <HeadC S={S} accent={accent} caption={refund.caption} onCaption={v => update('refund', { caption: v })} title={refund.title} onTitle={v => update('refund', { title: v })} />
      <div style={{ padding: `60px ${SIDE}px 90px` }}>
        <div style={{ background: '#f4f4f4', borderRadius: 18, padding: '28px 32px' }}>
          <EditableText value={refund.lead} onChange={v => update('refund', { lead: v })} placeholder="안내" style={{ ...S.body, color: textColor }} />
        </div>
        <div style={{ height: 34 }} />
        {refund.items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 20, marginBottom: idx === refund.items.length - 1 ? 0 : 30 }}>
            <div style={{ width: 14, height: 14, background: accent, flexShrink: 0, marginTop: S.px(12), borderRadius: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <EditableText value={item.title} onChange={editAt(refund.items, idx, (it, v) => ({ ...it, title: v }), items => update('refund', { items }))} placeholder="제목" style={S.strong} />
              <div style={{ height: 8 }} />
              <EditableText value={item.body} onChange={editAt(refund.items, idx, (it, v) => ({ ...it, body: v }), items => update('refund', { items }))} placeholder="내용" style={S.body} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CommonDeadline: React.FC<CommonBlockProps> = props =>
  props.info.design === 'B' ? <DeadlineB {...props} /> : props.info.design === 'C' ? <DeadlineC {...props} /> : <DeadlineA {...props} />;

export const CommonGuides: React.FC<CommonBlockProps> = props =>
  props.info.design === 'B' ? <GuidesB {...props} /> : props.info.design === 'C' ? <GuidesC {...props} /> : <GuidesA {...props} />;
