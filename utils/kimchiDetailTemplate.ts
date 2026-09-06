import { generateId } from './id';

// 김치 상세페이지 템플릿 — 기본 템플릿(detailPageCopyTemplate.ts)과 완전히 분리돼 있다.
// 상품등록에서 여는 상세페이지는 기존 템플릿 그대로, 이 템플릿은 헤더의 "상페작업" 버튼으로
// 여는 독립 모드에서만 쓴다(App.tsx의 standalone 참고).
//
// 구조의 핵심: 페이지는 "섹션의 배열"이고, 섹션 하나가 [문구 + 자기 사진 업로드 칸] 한 세트다.
// 세트째로 순서를 바꾸고 지울 수 있으며, 사진은 섹션 id로 묶여 있어서(photoSectionMap) 업로드
// 순서가 배치에 전혀 영향을 주지 않는다.

// 섹션이 문구를 담는 방식. 새 섹션 디자인이 필요하면 여기에 종류를 추가하고
// KimchiDetailSections.tsx의 렌더러에 대응 분기를 넣으면 된다.
export type KimchiSectionKind =
  | 'hero'   // 제품명 + 후킹문구 (가장 큰 글씨, 가운데)
  | 'text'   // 제목 + 본문 한 덩어리. number를 주면 왼쪽에 01/02 같은 큰 번호가 붙는다
  | 'list'   // 제목 + 항목 여러 줄 (카드/체크/번호 스타일)
  | 'pairs'   // 제목 + 라벨·값 두 열 (재료 산지, 표시사항 표 등)
  | 'notice'  // 아이콘 + 큰 제목 + 강조 문구 + 점선으로 나눈 안내 문구 (배송/유의사항 고지용)
  | 'review'   // 아이콘 + 평점 + 리뷰 카드들. 카드마다 오른쪽에 작은 사진이 붙는다
  | 'feature'  // 강조색 띠 + 사진 + 아래 설명 블록 (특별한점 소개용)
  | 'cert'     // 가운데 로고 + 가로줄 사이 제목 + 설명 + 큰 마무리 (인증 마크 소개용)
  | 'point';   // 알약 배지 + 왼쪽 정렬 제목/설명 + 전체폭 사진 (소구점 하나를 소개)

export type KimchiListStyle = 'card' | 'check' | 'number' | 'dot';
// 'qna'는 라벨을 질문(Q), 값을 답변(A)으로 그린다 — 자주 묻는 질문 섹션용.
export type KimchiPairsStyle = 'inline' | 'table' | 'qna';
export type KimchiAlign = 'left' | 'center';

export interface KimchiPairRow {
  label: string;
  value: string;
}

export interface KimchiSection {
  // 섹션 인스턴스 id. 사진도 이 id로 묶이므로(photoSectionMap) 섹션을 지우면 그 사진도 같이 빠진다.
  id: string;
  kind: KimchiSectionKind;
  // 미리보기에 뜨는 섹션 제목과 그 위 영문 캡션. 둘 다 비우면 제목 줄 자체가 빠진다.
  title: string;
  caption: string;
  // 사진을 본문 위에 둘지 아래에 둘지. 감성컷처럼 사진이 먼저 오는 섹션은 'before'.
  photoPosition: 'before' | 'after';
  // 사진을 한 장만 받을지, 여러 장 이어 붙일지.
  multiplePhotos: boolean;
  // 사이드패널 업로드 칸에 뜨는 안내 문구.
  hint: string;
  // AI 프롬프트에 쓸 라벨. 제목 없이 나가야 하는 섹션(마무리 문구 등)도 프롬프트에서는 이름이
  // 있어야 하므로 따로 둔다. 비워두면 title을, 그것도 비면 종류 이름을 쓴다.
  promptLabel?: string;
  // 상품이 바뀌어도 그대로 쓰는 고정 문구(배송 안내 등)는 AI에게 새로 받을 이유가 없다. 켜두면
  // 프롬프트에서 빠진다. 붙여넣기 인식은 계속 되므로, 예전 문구를 그대로 붙여넣는 건 여전히 된다.
  excludeFromPrompt?: boolean;

  // ── kind별 내용 ──
  // ── hero(인트로) ──
  // 배지 → 작은 제목 → 큰 제목 2줄 → 설명 → 제품구성 바 순서로 쌓인다. 비운 줄은 통째로 빠지므로
  // 필요한 것만 채워 쓰면 된다. 문구 블록 전체가 backgroundColor 위에 얹히고, 사진은 그 아래로
  // 배경 없이 전체폭으로 붙는다.
  badge?: string;            // 빨간 테두리 배지 (예: 문경 사과농원)
  eyebrow?: string;          // 배지 아래 작은 제목 (예: GAP 인증 문경 사과)
  headline?: string;         // 강조색 큰 제목
  headlineAccent?: string;   // 그 아래 한 단계 더 큰 제목
  subtitle?: string;         // 회색 설명 (여러 줄)
  specLabel?: string;        // 제품구성 바 왼쪽 (어두운 칩)
  specValue?: string;        // 제품구성 바 오른쪽 (강조색 칩)
  // 이 섹션만 다른 강조색을 쓰고 싶을 때. 비워두면 템플릿 전체의 시그니처 색을 따른다.
  accentColor?: string;

  // ── notice(고지) ──
  // 아이콘 → 제목 → 부제 → 큰 강조 문구 → 어두운 안내 카드 순서로 쌓인다. 배송 마감시각처럼
  // 눈에 확 들어와야 하는 고지에 쓴다. 비운 줄은 통째로 빠진다.
  icon?: string;            // 이모지 한 글자 (예: 🚚)
  noticeTitle?: string;     // 가장 큰 제목 (예: 오늘 출발)
  noticeSubtitle?: string;  // 그 아래 한 줄 (예: 오전 10시까지 주문시)
  bigText?: string;         // 숫자처럼 크게 박히는 강조 문구 (예: 10:00)
  cards?: string[];         // 점선으로 나뉘는 안내 문구들

  // ── review(리뷰) ──
  // notice와 icon·noticeTitle·noticeSubtitle·bigText를 함께 쓴다(각각 아이콘·제목·부제·평점).
  // 이 섹션에 올린 사진은 위에서부터 차례로 리뷰 카드 오른쪽 썸네일로 들어간다 — 그래서 전체폭
  // 사진으로는 그리지 않는다(KimchiDetailSections의 photosConsumedByBody 참고).
  scoreSuffix?: string;     // 평점 뒤에 작게 붙는 단위 (예: /5)
  reviews?: { text: string; author: string; stars: string }[];

  // ── feature(특별한점) ──
  // 위에서부터 [강조색 띠] → [사진] → [아래 설명 블록] 세 덩어리로 쌓인다. 본문은 'text'와 같은
  // body 필드를 함께 쓴다.
  bandSmall?: string;   // 띠 안 작은 줄
  bandBig?: string;     // 띠 안 큰 줄
  heading?: string;     // 아래 블록의 강조색 소제목
  bottomColor?: string; // 아래 블록 배경색

  // ── cert(인증) ──
  // 올린 사진을 전체폭이 아니라 가운데 작은 로고로 그린다. 제목은 위아래 가로줄 사이에 놓이고,
  // 그 아래 설명(body)과 큰 마무리 문구(bigText)가 이어진다 — 세 필드 모두 다른 kind와 공유한다.
  logoWidth?: number;   // 로고로 그릴 사진의 가로 크기(px). 비우면 기본값

  // ── point(소구점) ──
  // badge(알약 배지) + noticeTitle(큰 제목) + noticeSubtitle(설명)을 왼쪽 정렬로 쌓고 사진이 따른다.
  // 개수가 상품마다 달라서 기본은 하나만 두고, 필요하면 섹션 복사(⧉)로 늘린다.

  // ── 모든 섹션 공통 ──
  // 섹션 블록 뒤에 깔리는 색. 비워두면 색을 칠하지 않는다(=페이지 바탕 그대로).
  backgroundColor?: string;
  body?: string;                     // text
  align?: KimchiAlign;               // text
  number?: string;                   // text — 왼쪽 큰 번호 (예: '01')
  items?: string[];                  // list
  listStyle?: KimchiListStyle;       // list
  rows?: KimchiPairRow[];            // pairs
  pairsStyle?: KimchiPairsStyle;     // pairs
}

// 섹션 추가 메뉴에 뜨는 종류들.
export const KIMCHI_SECTION_KIND_OPTIONS: { kind: KimchiSectionKind; label: string; description: string }[] = [
  { kind: 'hero', label: '인트로', description: '제품명 + 후킹문구' },
  { kind: 'text', label: '글', description: '제목 + 본문 (번호 붙일 수 있음)' },
  { kind: 'list', label: '목록', description: '제목 + 항목 여러 줄' },
  { kind: 'pairs', label: '두 열', description: '라벨 + 값 (재료 산지, 표 등)' },
  { kind: 'notice', label: '고지', description: '아이콘 + 큰 문구 + 점선 안내' },
  { kind: 'review', label: '리뷰', description: '평점 + 리뷰 카드 (카드마다 사진)' },
  { kind: 'feature', label: '특별한점', description: '강조색 띠 + 사진 + 설명 블록' },
  { kind: 'cert', label: '인증', description: '가운데 로고 + 가로줄 제목 + 설명' },
  { kind: 'point', label: '소구점', description: '배지 + 왼쪽 제목/설명 + 사진' },
];

export function createKimchiSection(kind: KimchiSectionKind, overrides: Partial<KimchiSection> = {}): KimchiSection {
  const base: KimchiSection = {
    id: generateId(),
    kind,
    title: '',
    caption: '',
    photoPosition: 'after',
    multiplePhotos: true,
    hint: '',
  };
  const byKind: Partial<KimchiSection> =
    kind === 'hero' ? {
      badge: '', eyebrow: '', headline: '', headlineAccent: '', subtitle: '',
      specLabel: '제품구성', specValue: '',
      backgroundColor: '#ffffff',
    }
    : kind === 'text' ? { body: '', align: 'left' }
    : kind === 'list' ? { items: ['', '', '', ''], listStyle: 'card' }
    : kind === 'pairs' ? { rows: [{ label: '', value: '' }], pairsStyle: 'inline' }
    : kind === 'point' ? {
        badge: '', noticeTitle: '', noticeSubtitle: '',
      }
    : kind === 'cert' ? {
        noticeTitle: '', body: '', bigText: '', backgroundColor: '#f6f6f6',
      }
    : kind === 'feature' ? {
        bandSmall: '', bandBig: '', heading: '', body: '',
        bottomColor: '#ddd9d5',
      }
    : kind === 'notice' ? { icon: '', noticeTitle: '', noticeSubtitle: '', bigText: '', cards: ['', ''] }
    : {
        icon: '', badge: '★★★★★', noticeTitle: '', noticeSubtitle: '', bigText: '', scoreSuffix: '/5',
        reviews: [
          { text: '', author: '', stars: '★★★★★' },
          { text: '', author: '', stars: '★★★★★' },
          { text: '', author: '', stars: '★★★★★' },
        ],
      };
  return { ...base, ...byKind, ...overrides };
}

// 처음 열었을 때 깔려 있는 기본 구성. 어디까지나 출발점이고, 순서 변경·삭제·추가로 얼마든지
// 바꿀 수 있다. 섹션 하나하나가 자기 사진 업로드 칸을 갖는다.
export function createDefaultKimchiSections(): KimchiSection[] {
  return [
    createKimchiSection('hero', {
      title: '', caption: '', hint: '대표컷 — 여러 장 올리면 아래로 이어집니다',
    }),
    // 배송 안내는 상품이 바뀌어도 거의 그대로인 고정 문구라 기본값을 채워둔다. 화면에서 글자를
    // 눌러 바로 고칠 수 있고, excludeFromPrompt 때문에 AI 프롬프트에도 나가지 않아 덮어써지지 않는다.
    createKimchiSection('notice', {
      title: '', caption: '', promptLabel: '배송',
      icon: '🚚',
      noticeTitle: '오늘 출발',
      noticeSubtitle: '오전 10시까지 주문시',
      bigText: '10:00',
      cards: [
        '오전 10시 이후 제조 및 출고 시작으로\n주문취소 및 주문수정이 불가하오니\n신중 구매 부탁드립니다.',
        '산지 상황에 따라 도착예정일보다\n지연되거나 빨리 도착할 수 있으니\n신중 구매 부탁드립니다.',
      ],
      hint: '없어도 됩니다', excludeFromPrompt: true,
    }),
    createKimchiSection('review', {
      title: '', caption: '', promptLabel: '리뷰',
      hint: '리뷰 카드마다 오른쪽에 한 장씩 들어갑니다',
    }),
    ...['01', '02', '03'].map(n =>
      createKimchiSection('feature', {
        title: '', caption: '', promptLabel: `특별한점 ${n}`,
        hint: '띠와 설명 사이에 들어갑니다',
      })
    ),
    createKimchiSection('cert', {
      title: '', caption: '', promptLabel: '인증',
      hint: '인증 마크 이미지 (가운데 작게 들어갑니다)', multiplePhotos: false,
    }),
    createKimchiSection('point', {
      title: '', caption: '', promptLabel: '소구점 01',
      hint: '이 소구점을 보여주는 사진',
    }),
    createKimchiSection('pairs', {
      title: '자주 묻는 질문', caption: 'Q&A', promptLabel: 'QA', pairsStyle: 'qna',
      rows: [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }],
      hint: '없어도 됩니다',
    }),
    createKimchiSection('list', {
      title: '보관방법 및 주의사항', caption: 'STORAGE', promptLabel: '보관', listStyle: 'dot',
      items: ['', '', '', ''], hint: '없어도 됩니다',
    }),
    createKimchiSection('pairs', {
      title: '반품 및 교환 안내', caption: 'RETURN', promptLabel: '반품', pairsStyle: 'table',
      rows: ['반품·교환 기간', '반품 배송비', '반품 주소', '반품·교환 불가'].map(label => ({ label, value: '' })),
      hint: '없어도 됩니다',
    }),
    createKimchiSection('notice', {
      title: '', caption: '', promptLabel: 'CS',
      icon: '☎️', noticeTitle: '', noticeSubtitle: '', bigText: '', cards: ['', ''],
      hint: '없어도 됩니다',
    }),
    // 가공식품은 온라인 판매 시 상세페이지에 고지해야 하는 항목이 정해져 있다(판매 채널별
    // 상품정보제공고시 기준). 값이 빈 줄은 표에서 빠지지만, 판매 전에 채널 기준으로 한 번
    // 대조해보는 게 안전하다.
    createKimchiSection('pairs', {
      title: '식품 표시사항', caption: 'PRODUCT INFORMATION', promptLabel: '표시사항', pairsStyle: 'table',
      rows: [
        '식품유형', '제조원 / 소재지', '내용량', '원재료명 및 함량',
        '유통기한', '보관방법', '알레르기 유발물질', '반품 / 교환',
      ].map(label => ({ label, value: '' })),
      hint: '없어도 됩니다',
    }),
  ];
}

// ── 섹션 목록 조작 ──────────────────────────────────────────────────────────────

export function moveKimchiSection(sections: KimchiSection[], id: string, direction: -1 | 1): KimchiSection[] {
  const index = sections.findIndex(s => s.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeKimchiSection(sections: KimchiSection[], id: string): KimchiSection[] {
  return sections.filter(s => s.id !== id);
}

// 이름 끝의 번호를 하나 올린다: '소구점 01' → '소구점 02' (자릿수 유지). 번호가 없으면 그대로.
function bumpTrailingNumber(label: string): string {
  const m = label.match(/^(.*?)(\d+)\s*$/);
  if (!m) return label;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}

// 새 섹션을 더한다. 같은 종류가 이미 있으면 그 마지막 섹션 바로 뒤에 끼워 넣고(소구점을 더하면
// 소구점 01 밑에 붙는다), 이름에도 번호를 붙인다 — 이름이 곧 붙여넣기 라벨이라
// (sectionBaseLabel) 둘 다 '소구점'이면 어느 쪽에 넣을지 알 수 없고, '소구점 02 제목' 같은
// 라벨은 아예 갈 곳이 없어진다.
export function appendKimchiSection(sections: KimchiSection[], kind: KimchiSectionKind): KimchiSection[] {
  const section = createKimchiSection(kind);
  const fallback = KIND_FALLBACK_LABEL[kind];
  const escaped = fallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numbered = new RegExp('^' + escaped + '\\s*\\d+$');
  const taken = new Set(sections.map(sectionBaseLabel));
  const sameKindCount = [...taken].filter(b => b === fallback || numbered.test(b)).length;
  if (sameKindCount > 0) {
    let n = sameKindCount + 1;
    let name = `${fallback} ${String(n).padStart(2, '0')}`;
    while (taken.has(name)) name = `${fallback} ${String(++n).padStart(2, '0')}`;
    section.promptLabel = name;
  }
  // 같은 종류의 마지막 섹션 바로 뒤에 넣는다(없으면 맨 뒤).
  let insertAfter = -1;
  sections.forEach((s, i) => {
    if (s.kind === kind) insertAfter = i;
  });
  if (insertAfter === -1) return [...sections, section];
  return [...sections.slice(0, insertAfter + 1), section, ...sections.slice(insertAfter + 1)];
}

// 섹션을 통째로 복제해서 바로 아래에 끼워 넣는다. 사진은 따라오지 않는다 — 복사는 보통 "같은
// 모양의 블록을 하나 더" 쓰려는 것이고(소구점 02를 추가하는 식), 사진까지 복제하면 같은 이미지가
// 두 번 박힌 채로 시작하게 된다. 문구는 그대로 복사되니 고쳐 쓰면 된다.
//
// 이름은 끝 번호를 올려서 이미 쓰고 있는 것과 겹치지 않게 한다 — 이름이 곧 붙여넣기 라벨이라
// (sectionBaseLabel) 그대로 복사하면 두 섹션이 같은 라벨을 갖고 뒤엣것이 '소구점 01 2'가 된다.
export function duplicateKimchiSection(sections: KimchiSection[], id: string): KimchiSection[] {
  const index = sections.findIndex(s => s.id === id);
  if (index === -1) return sections;
  const source = sections[index];
  const taken = new Set(sections.map(sectionBaseLabel));
  const nameKey = source.promptLabel?.trim() ? 'promptLabel' as const : 'title' as const;
  let nextName = source[nameKey] || '';
  if (nextName) {
    do { nextName = bumpTrailingNumber(nextName); } while (taken.has(nextName) && /\d\s*$/.test(nextName));
  }
  const copy: KimchiSection = {
    ...source,
    id: generateId(),
    ...(nextName && nextName !== source[nameKey] ? { [nameKey]: nextName } : {}),
    items: source.items ? [...source.items] : undefined,
    rows: source.rows ? source.rows.map(r => ({ ...r })) : undefined,
    cards: source.cards ? [...source.cards] : undefined,
    reviews: source.reviews ? source.reviews.map(r => ({ ...r })) : undefined,
  };
  return [...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)];
}

// 섹션에 실제로 채워진 문구가 하나라도 있는지 — 비어 있으면 미리보기에서 통째로 빠진다
// (사진만 있는 섹션은 사진만 나온다).
export function kimchiSectionHasText(section: KimchiSection): boolean {
  const filled = (v?: string) => !!v && v.trim() !== '';
  switch (section.kind) {
    case 'hero':
      return [section.badge, section.eyebrow, section.headline, section.headlineAccent, section.subtitle, section.specValue].some(filled);
    case 'text': return filled(section.body);
    case 'list': return (section.items || []).some(filled);
    case 'pairs': return (section.rows || []).some(r => filled(r.value) || filled(r.label));
    case 'notice':
      return [section.icon, section.noticeTitle, section.noticeSubtitle, section.bigText].some(filled)
        || (section.cards || []).some(filled);
    case 'review':
      return [section.icon, section.noticeTitle, section.noticeSubtitle, section.bigText].some(filled)
        || (section.reviews || []).some(r => filled(r.text) || filled(r.author));
    case 'feature':
      return [section.bandSmall, section.bandBig, section.heading, section.body].some(filled);
    case 'cert':
      return [section.noticeTitle, section.body, section.bigText].some(filled);
    case 'point':
      return [section.badge, section.noticeTitle, section.noticeSubtitle].some(filled);
  }
}

// ── AI 프롬프트 / 붙여넣기 ──────────────────────────────────────────────────────
// 라벨을 고정 목록으로 박아두지 않고 "현재 섹션 구성"에서 매번 만들어낸다. 그래서 섹션을 바꾸면
// 프롬프트와 파서가 자동으로 따라오고, 섹션을 새로 추가해도 손볼 곳이 없다.

// 라벨이 겹치면 뒤에 번호를 붙여 유일하게 만든다(프롬프트에 찍히는 문자열과 파서가 찾는 문자열이
// 같아야 하므로, 만드는 곳은 반드시 이 함수 하나로 통일한다).
// 파서가 라벨 안 띄어쓰기를 무시하므로("보관 방법" == "보관방법"), 중복 검사도 공백을 지운
// 형태로 해야 한다. 안 그러면 서로 다른 라벨로 프롬프트에 나가놓고 파싱에서는 같은 걸로 취급돼
// 뒤쪽 항목이 영영 안 채워진다.
function uniqueLabel(used: Set<string>, base: string): string {
  const key = (v: string) => v.replace(/\s/g, '');
  let label = base;
  let n = 2;
  while (used.has(key(label))) label = `${base} ${n++}`;
  used.add(key(label));
  return label;
}

// 예전 라벨 이름을 붙여준다. 이미 다른 슬롯이 그 이름을 쓰고 있으면 포기한다 — 같은 이름이 두
// 슬롯을 가리키면 어느 쪽에 넣을지 알 수 없기 때문이다.
function claimAlias(used: Set<string>, name: string): string[] {
  const key = name.replace(/\s/g, '');
  if (used.has(key)) return [];
  used.add(key);
  return [name];
}

const KIND_FALLBACK_LABEL: Record<KimchiSectionKind, string> = {
  hero: '인트로', text: '본문', list: '목록', pairs: '항목', notice: '고지', review: '리뷰',
  feature: '특별한점', cert: '인증', point: '소구점',
};

// 섹션 하나가 문구를 받는 자리들. field는 파싱 결과를 어디에 꽂을지 가리킨다.
type HeroField = 'badge' | 'eyebrow' | 'headline' | 'headlineAccent' | 'subtitle' | 'specValue';
type NoticeField = 'icon' | 'noticeTitle' | 'noticeSubtitle' | 'bigText' | 'scoreSuffix';
type FeatureField = 'bandSmall' | 'bandBig' | 'heading';

// aliases: 예전에 쓰던 라벨 이름. 라벨을 고치더라도 이미 그 이름으로 써둔 글이 계속 먹히게 한다
// — 이름만 바꾸고 옛 이름을 버리면, 그 줄이 라벨로 안 잡혀서 앞 항목 내용에 딸려 들어간다.
type KimchiSlot =
  | { sectionIndex: number; field: HeroField | NoticeField | FeatureField | 'body'; label: string; aliases?: string[]; hint: string; twoLine: false }
  | { sectionIndex: number; field: 'item' | 'card' | 'reviewText' | 'reviewAuthor'; itemIndex: number; label: string; aliases?: string[]; hint: string; twoLine: false }
  | { sectionIndex: number; field: 'rowValue'; rowIndex: number; label: string; aliases?: string[]; hint: string; twoLine: false }
  | { sectionIndex: number; field: 'rowPair'; rowIndex: number; label: string; aliases?: string[]; hint: string; twoLine: true };

function buildSlots(sections: KimchiSection[]): KimchiSlot[] {
  const used = new Set<string>();
  const slots: KimchiSlot[] = [];
  sections.forEach((section, sectionIndex) => {
    const base = sectionBaseLabel(section);
    switch (section.kind) {
      case 'hero':
        ([
          ['badge', '배지', '농원/브랜드 이름 한 줄. 예: 한나김치'],
          ['eyebrow', '작은 제목', '인증·산지 한 줄. 예: HACCP 인증 여수 김치'],
          ['headline', '큰 제목', '눈길을 끄는 1~2줄. 예: 알타리무에 무청이 / 그대로 달린'],
          ['headlineAccent', '큰 제목 2', '제품을 가리키는 2~3줄. 예: 제대로 된 / 총각김치만을 / 담았습니다.'],
          ['subtitle', '설명', '2~3줄. 예: 오전에 정성껏 담가 / 오늘 만든 김치를 / 오늘 바로 보내드립니다.'],
          ['제품구성', '제품구성', '구성과 중량 한 줄. 예: 여수 총각김치 2kg, 3kg, 5kg'],
        ] as const).forEach(([field, base, hint]) => {
          const key = field === '제품구성' ? 'specValue' : field;
          slots.push({ sectionIndex, field: key as HeroField, label: uniqueLabel(used, base), hint, twoLine: false });
        });
        break;
      case 'text':
        slots.push({ sectionIndex, field: 'body', label: uniqueLabel(used, base), hint: '1~3문장', twoLine: false });
        break;
      case 'list':
        (section.items || []).forEach((_, itemIndex) => {
          slots.push({
            sectionIndex, field: 'item', itemIndex,
            label: uniqueLabel(used, `${base} ${String(itemIndex + 1).padStart(2, '0')}`),
            hint: '짧은 한 줄. 예: 0~5℃ 냉장 보관해주세요.', twoLine: false,
          });
        });
        break;
      case 'notice':
        // 아이콘·제목 같은 이름은 다른 섹션에도 있으므로 섹션 이름을 앞에 붙여 구분한다
        // ("배송 아이콘"). 안 그러면 뒤에 오는 섹션이 "아이콘 2" 같은 이름을 받아 헷갈린다.
        ([
          ['icon', '아이콘', '이모지 하나. 예: 🚚', []],
          ['noticeTitle', '제목', '가장 크게 박힐 한 줄. 예: 오늘 출발', ['고지 제목']],
          ['noticeSubtitle', '부제', '조건을 밝히는 한 줄. 예: 오전 10시까지 주문시', ['고지 부제']],
          ['bigText', '강조 문구', '아주 크게 박힐 짧은 문구. 예: 10:00', []],
        ] as const).forEach(([field, suffix, hint, oldLabels]) => {
          slots.push({
            sectionIndex, field, label: uniqueLabel(used, `${base} ${suffix}`),
            aliases: [...oldLabels], hint, twoLine: false,
          });
        });
        (section.cards || []).forEach((_, itemIndex) => {
          const n = String(itemIndex + 1).padStart(2, '0');
          slots.push({
            sectionIndex, field: 'card', itemIndex,
            label: uniqueLabel(used, `${base} 안내 ${n}`),
            // 예전에는 섹션 이름 없이 '안내 01'이었다. 고지 섹션이 하나뿐이던 시절에 그 이름으로
            // 써둔 글이 계속 먹히도록, 아직 아무도 안 가져간 경우에만 옛 이름을 붙여준다.
            aliases: claimAlias(used, `안내 ${n}`),
            hint: '2~3줄. 예: 오전 10시 이후 제조 및 출고 시작으로 / 주문취소 및 주문수정이 불가하오니 / 신중 구매 부탁드립니다.', twoLine: false,
          });
        });
        break;
      case 'review':
        ([
          ['icon', '아이콘', '이모지 하나. 예: 👍', []],
          ['noticeTitle', '제목', '1~2줄. 예: 리뷰를 / 확인해주세요!', []],
          ['noticeSubtitle', '부제', '한 줄. 예: 실제 구매 후기입니다', []],
          ['bigText', '평점', '평점 숫자만. 예: 4.9', ['평점']],
          ['scoreSuffix', '평점 단위', '예: /5', ['평점 단위']],
        ] as const).forEach(([field, suffix, hint, oldLabels]) => {
          slots.push({
            sectionIndex, field, label: uniqueLabel(used, `${base} ${suffix}`),
            aliases: [...oldLabels], hint, twoLine: false,
          });
        });
        (section.reviews || []).forEach((_, itemIndex) => {
          const n = String(itemIndex + 1).padStart(2, '0');
          slots.push({ sectionIndex, field: 'reviewText', itemIndex, label: uniqueLabel(used, `리뷰 ${n}`), hint: '구매자 후기처럼 2~3줄 (판매자가 실제 후기로 교체할 초안)', twoLine: false });
          slots.push({ sectionIndex, field: 'reviewAuthor', itemIndex, label: uniqueLabel(used, `작성자 ${n}`), hint: '예: haey***', twoLine: false });
        });
        break;
      case 'feature':
        ([
          ['bandSmall', '윗줄', '브랜드를 곁들인 짧은 한 줄. 예: 건강을 생각한 한나김치', []],
          ['bandBig', '제목', '핵심을 한마디로. 예: 화학 조미료 0%', []],
          ['heading', '소제목', '강조할 1~2줄. 예: 양념은 물론 / 젓갈까지 MSG 무첨가!', []],
          ['body', '본문', '2~4줄. 예: 청정 여수의 농수산물! / 3년간 간수 뺀 천일염!', []],
        ] as const).forEach(([field, suffix, hint, oldSuffixes]) => {
          slots.push({
            sectionIndex, field, label: uniqueLabel(used, `${base} ${suffix}`),
            aliases: oldSuffixes.map(o => `${base} ${o}`), hint, twoLine: false,
          });
        });
        break;
      case 'point':
        ([
          ['badge', '배지', '예: POINT 01'],
          ['noticeTitle', '제목', '핵심을 짚는 1~2줄. 예: 3년간 간수뺀 / 신안 천일염'],
          ['noticeSubtitle', '설명', '풀어서 1~2줄. 예: 전남 신안군 신의면에서 3년간 / 간수를 뺀 재래식 천일염만 사용'],
        ] as const).forEach(([field, suffix, hint]) => {
          slots.push({ sectionIndex, field, label: uniqueLabel(used, `${base} ${suffix}`), hint, twoLine: false });
        });
        break;
      case 'cert':
        ([
          ['noticeTitle', '제목', '인증 이름 한 줄. 예: HACCP 인증'],
          ['body', '본문', '2~4줄. 예: 깨끗하고, / 안전하게, / 정성껏 / 제조하였습니다.'],
          ['bigText', '마무리', '크게 박힐 짧은 1~2줄. 예: 안심하고 / 드세요!'],
        ] as const).forEach(([field, suffix, hint]) => {
          slots.push({ sectionIndex, field, label: uniqueLabel(used, `${base} ${suffix}`), hint, twoLine: false });
        });
        break;
      case 'pairs':
        (section.rows || []).forEach((row, rowIndex) => {
          // 표 형태는 라벨이 이미 고정돼 있으니(식품유형, 유통기한 …) 값만 받고, 자유 형태는
          // 라벨과 값을 두 줄로 받는다(재료명 / 산지처럼 라벨도 매번 달라지는 경우).
          if (section.pairsStyle === 'table' && row.label.trim()) {
            slots.push({ sectionIndex, field: 'rowValue', rowIndex, label: uniqueLabel(used, row.label.trim()), hint: '이 상품에 맞게 채워줘 (판매자가 실제 값으로 확인·교체)', twoLine: false });
          } else {
            slots.push({
              sectionIndex, field: 'rowPair', rowIndex,
              label: uniqueLabel(used, `${base} ${String(rowIndex + 1).padStart(2, '0')}`),
              hint: '첫 줄은 질문, 다음 줄부터 답변', twoLine: true,
            });
          }
        });
        break;
    }
  });
  return slots;
}

export interface KimchiCopyInput {
  productName: string;
  sellingPoints: string;
}

export function buildKimchiCopyPrompt(sections: KimchiSection[], input: KimchiCopyInput): string {
  const lines: string[] = [
    '너는 김치 쇼핑몰 상세페이지 카피라이터야. 아래 상품 정보로 상세페이지 문구를 써줘.',
    '',
    '[상품 정보]',
    `상품명: ${input.productName || '(아래 빈칸을 채워주세요)'}`,
    `소구점 메모: ${input.sellingPoints || '(아래 빈칸을 채워주세요)'}`,
    '중량/구성:',
    '재료와 원산지:',
    '제조 방식(절임·양념·숙성 등):',
    '다른 김치와 다른 점:',
    '배송 방식과 출고 기준:',
    '고객센터 번호와 운영시간:',
    '',
    '[쓰는 방법]',
    '1. 모든 라벨을 빠짐없이 채워줘. 빈 라벨을 하나도 남기지 마.',
    '2. 위 상품 정보에 있는 내용은 그대로 쓰고, 없는 항목은 이 상품에 있을 법한 값으로 채워줘.',
    '3. 이건 판매자가 손봐서 쓸 초안이야. 원산지·함량·유통기한·인증·전화번호·반품 조건·평점·후기처럼',
    '   사실 확인이 필요한 값은 그럴듯한 예시로 채우되, 판매자가 실제 값으로 바꿀 자리라는 걸 전제로 써줘.',
    '4. 식품이라 효능을 단정하거나 "최고"·"1위" 같은 최상급 표현은 쓰지 마. 담백하고 믿음이 가는 톤으로.',
    '',
    '[형식]',
    '라벨은 한 글자도 바꾸지 말고, 순서도 그대로 두고, 라벨 다음 줄부터 내용만 채워줘.',
    '줄을 나누고 싶으면 그냥 엔터로 나눠줘(<br> 같은 태그 금지). 앞뒤에 인사말이나 설명을 붙이지 마.',
    '괄호 안은 예시니까 그대로 베끼지 말고 이 상품에 맞게 새로 써줘.',
    '',
  ];
  // 고정 문구로 표시한 섹션은 프롬프트에서 뺀다(파싱에서는 계속 인식된다 — buildSlots는 그대로).
  buildSlots(sections).forEach(slot => {
    if (sections[slot.sectionIndex]?.excludeFromPrompt) return;
    lines.push(slot.label);
    if (slot.twoLine) lines.push(`(${slot.hint || '첫 줄 · 예: 배추'})`, '(둘째 줄 · 예: 해남 국내산)');
    else lines.push(`(${slot.hint})`);
    lines.push('');
  });
  return lines.join('\n');
}

// 라벨 뒤에 올 수 있는 형태 세 가지를 모두 받는다:
//   "라벨"              (내용은 다음 줄부터)
//   "라벨: 내용"        (콜론으로 구분)
//   "라벨   내용"       (공백으로 구분 — 한 줄에 라벨과 내용을 같이 쓰는 경우)
// 공백 구분을 허용하되 라벨 바로 뒤에 글자가 붙은 경우("설명이 부족합니다")는 라벨로 보지 않도록,
// 콜론이나 공백이 반드시 하나는 있어야 매칭되게 했다.
// 라벨 오타로 볼 수 있는 줄의 최대 길이. 이보다 길면 라벨이 아니라 본문으로 취급한다.
const UNKNOWN_LABEL_MAX_LENGTH = 20;
// 섹션 이름 뒤에 붙는 필드 이름의 최대 길이(예: '제목', '안내 01', '강조 문구').
const UNKNOWN_LABEL_MAX_SUFFIX = 8;

// 라벨 끝에 오는 필드 이름들. 섹션 이름이 안 맞아도(예: '소구점 02 배지'인데 지금 섹션은
// '소구점 01'뿐이라 아는 라벨이 아님) 이 낱말로 끝나면 라벨 자리로 보고 본문에 섞지 않는다 —
// 예전에 이런 줄이 앞 항목에 딸려 들어가 그대로 이미지에 찍힌 적이 있다.
const FIELD_NAME_WORDS = [
  '배지', '작은 제목', '큰 제목', '제목', '부제', '설명', '본문', '아이콘', '소제목', '윗줄',
  '강조 문구', '평점 단위', '평점', '마무리', '제품구성', '사진문구',
];
// 더 이상 쓰지 않는 라벨. 예전에 만들어둔 문구에 남아 있어도 조용히 건너뛴다 — 없앤 기능인데
// "못 알아본 라벨"이라고 경고를 띄우면 사용자가 고칠 방법이 없다.
const RETIRED_LABEL_SUFFIXES = ['사진문구', '사선문구'];

const FIELD_NAME_TAIL = new RegExp(
  '(?:^|\\s)(?:' + FIELD_NAME_WORDS.map(w => w.split(' ').join('\\s*')).join('|') + '|안내\\s*\\d+)\\s*$'
);

const LABEL_TAIL = '(?:\\s*[:：]\\s*(.*)|\\s+(\\S.*)|\\s*)$';

// 라벨 안 띄어쓰기 차이("후킹 문구" / "후킹문구")를 흡수하도록 글자 사이에 \s*를 끼워 넣는다.
function looseLabelPattern(label: string): RegExp {
  const body = label
    .split('')
    .filter(ch => !/\s/.test(ch))
    .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  return new RegExp('^' + body + LABEL_TAIL);
}

// AI 답변에 섞여 오는 마크다운 잡음(**굵게**, # 헤딩, 목록 기호)은 라벨 인식 직전에 걷어낸다.
function stripMarkdownNoise(line: string): string {
  let s = line;
  s = s.replace(/^#{1,6}\s*/, '');
  s = s.replace(/^[-*•]\s+/, '');
  s = s.replace(/^\d+[.)]\s+/, '');
  const bold = s.match(/^\*\*(.*)\*\*$/) || s.match(/^__(.*)__$/);
  if (bold) s = bold[1];
  return s.trim();
}

function splitTwoPart(content: string): { head: string; body: string } {
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx === -1) return { head: content.trim(), body: '' };
  return { head: content.slice(0, newlineIdx).trim(), body: content.slice(newlineIdx + 1).trim() };
}

export interface KimchiParseResult {
  sections: KimchiSection[];
  // 실제로 채운 자리 수. 0이면 라벨 형식이 어긋났다는 뜻이라 앱에서 안내를 띄운다.
  filledCount: number;
  // 라벨처럼 생겼는데 아는 라벨이 아닌 줄들. 그냥 앞 항목 내용으로 삼켜버리면 그 글자가 그대로
  // 이미지에 찍혀 나오므로(예전에 라벨 이름을 바꿨을 때 실제로 그랬다), 삼키지 않고 여기 모아서
  // 앱이 "이 라벨은 못 알아봤다"고 알려줄 수 있게 한다.
  unknownLabels: string[];
}

export function parseKimchiCopyText(text: string, sections: KimchiSection[]): KimchiParseResult {
  const slots = buildSlots(sections);
  // 라벨이 서로의 앞부분과 겹칠 수 있으므로(예: '보관 방법' vs '보관'), 긴 라벨부터 맞춰본다.
  // 예전 이름(aliases)도 같은 슬롯을 가리키는 매처로 함께 넣는다.
  const matchers = slots
    .flatMap((slot, index) => [slot.label, ...(slot.aliases || [])].map(name => ({ index, name })))
    .map(({ index, name }) => ({ index, pattern: looseLabelPattern(name), length: name.replace(/\s/g, '').length }))
    .sort((a, b) => b.length - a.length);

  // "라벨 자리"로 보이는 줄을 알아보기 위한 잣대: 섹션 이름 + (줄끝 | 콜론 | 공백)으로 시작하는 줄.
  // 경계를 요구하지 않으면 '양념은 물론' 같은 본문이 섹션 이름 '양념'으로 시작한다는 이유로
  // 라벨로 오해받는다. 게다가 라벨은 짧으므로 길이 제한도 함께 둔다.
  const basePatterns = Array.from(new Set(sections.map(sectionBaseLabel)))
    .filter(Boolean)
    .map(b => new RegExp(
      '^(' + b.split('').filter(c => !/\s/.test(c)).map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
      + ')(?:$|[:：]|\\s)'
    ));
  // 라벨은 "섹션이름 + 짧은 필드이름"(제목, 부제, 안내 01 …) 꼴이다. 뒤가 길거나 띄어쓰기가 여러
  // 번 나오면 문장이라는 뜻이므로 본문으로 둔다 — 안 그러면 '배송 지연 시 안내드립니다' 같은 정상
  // 문구까지 라벨로 오해해서 버려버린다.
  // 없앤 라벨은 라벨로 인정하되 아무 데도 넣지 않는다(경고도 없음).
  const isRetiredLabel = (line: string) =>
    RETIRED_LABEL_SUFFIXES.some(suffix => new RegExp('(?:^|\\s)' + suffix + '\\s*$').test(line));

  const looksLikeLabelLine = (line: string) => {
    if (line.length > UNKNOWN_LABEL_MAX_LENGTH) return false;
    // 섹션 이름이 달라도(복사로 늘리기 전에 붙여넣은 '소구점 02 제목' 같은 경우) 필드 이름으로
    // 끝나고 낱말이 여러 개면 라벨 자리로 본다.
    if (FIELD_NAME_TAIL.test(line) && line.trim().includes(' ')) return true;
    for (const pattern of basePatterns) {
      const m = line.match(pattern);
      if (!m) continue;
      const suffix = line.slice(m[1].length).replace(/^[:：\s]+/, '').trim();
      if (suffix.length <= UNKNOWN_LABEL_MAX_SUFFIX && (suffix.match(/\s/g) || []).length <= 1) return true;
    }
    return false;
  };
  const unknownLabels: string[] = [];

  const buffers = new Map<number, string[]>();
  let currentSlot: number | null = null;
  // 라벨 바로 다음 줄은 그 라벨의 내용이다. 아직 아무것도 안 담은 상태에서는 라벨 오타 검사를
  // 건너뛴다 — 'CS 안내 01' 다음에 오는 'CS 문의'처럼, 섹션 이름으로 시작하는 짧은 내용을
  // 라벨로 오해해서 버리는 걸 막는다.
  let collectedForCurrent = false;

  text.split(/\r?\n/).forEach(rawLine => {
    const line = stripMarkdownNoise(rawLine);
    const hit = matchers.find(m => m.pattern.test(line));
    if (hit) {
      currentSlot = hit.index;
      collectedForCurrent = false;
      if (!buffers.has(currentSlot)) buffers.set(currentSlot, []);
      // 콜론 구분이면 1번 그룹, 공백 구분이면 2번 그룹에 내용이 잡힌다.
      const m = line.match(hit.pattern);
      const inline = (m?.[1] ?? m?.[2] ?? '').trim();
      if (inline) {
        buffers.get(currentSlot)!.push(inline);
        collectedForCurrent = true;
      }
      return;
    }
    // 아는 라벨은 아닌데 섹션 이름으로 시작하면 라벨 오타로 본다. 앞 항목에 딸려 들어가지 않도록
    // 담기를 멈추고 따로 모아둔다.
    if (line && isRetiredLabel(line)) {
      currentSlot = null;
      return;
    }
    if (line && (currentSlot === null || collectedForCurrent) && looksLikeLabelLine(line)) {
      unknownLabels.push(line);
      currentSlot = null;
      return;
    }
    if (currentSlot === null || !rawLine.trim()) return;
    // 내용 줄에 남은 목록 기호는 걷어낸다 — 대부분 한 줄짜리 짧은 문구라 불릿이 그대로
    // 이미지에 찍히면 안 된다.
    buffers.get(currentSlot)!.push(rawLine.trim().replace(/^[-*•]\s+/, ''));
    collectedForCurrent = true;
  });

  const next = sections.map(s => ({
    ...s,
    items: s.items ? [...s.items] : undefined,
    rows: s.rows ? s.rows.map(r => ({ ...r })) : undefined,
    cards: s.cards ? [...s.cards] : undefined,
    reviews: s.reviews ? s.reviews.map(r => ({ ...r })) : undefined,
  }));
  let filledCount = 0;

  buffers.forEach((buf, slotIndex) => {
    const content = buf.join('\n').trim();
    if (!content) return;
    const slot = slots[slotIndex];
    const section = next[slot.sectionIndex];
    filledCount++;
    switch (slot.field) {
      case 'badge': section.badge = content; break;
      case 'eyebrow': section.eyebrow = content; break;
      case 'headline': section.headline = content; break;
      case 'headlineAccent': section.headlineAccent = content; break;
      case 'subtitle': section.subtitle = content; break;
      case 'specValue': section.specValue = content; break;
      case 'body': section.body = content; break;
      case 'item': if (section.items) section.items[slot.itemIndex] = content; break;
      case 'card': if (section.cards) section.cards[slot.itemIndex] = content; break;
      case 'icon': section.icon = content; break;
      case 'noticeTitle': section.noticeTitle = content; break;
      case 'noticeSubtitle': section.noticeSubtitle = content; break;
      case 'bigText': section.bigText = content; break;
      case 'scoreSuffix': section.scoreSuffix = content; break;
      case 'bandSmall': section.bandSmall = content; break;
      case 'bandBig': section.bandBig = content; break;
      case 'heading': section.heading = content; break;
      case 'reviewText':
        if (section.reviews) section.reviews[slot.itemIndex] = { ...section.reviews[slot.itemIndex], text: content };
        break;
      case 'reviewAuthor':
        if (section.reviews) section.reviews[slot.itemIndex] = { ...section.reviews[slot.itemIndex], author: content };
        break;
      case 'rowValue': if (section.rows) section.rows[slot.rowIndex] = { ...section.rows[slot.rowIndex], value: content }; break;
      case 'rowPair': {
        if (!section.rows) break;
        const { head, body } = splitTwoPart(content);
        section.rows[slot.rowIndex] = { label: head, value: body };
        break;
      }
    }
  });

  return { sections: next, filledCount, unknownLabels };
}

// 섹션이 프롬프트 라벨에서 쓰는 이름(예: '특별한점 01', '배송', '재료').
export function sectionBaseLabel(section: KimchiSection): string {
  return section.promptLabel?.trim() || section.title.trim() || KIND_FALLBACK_LABEL[section.kind];
}
