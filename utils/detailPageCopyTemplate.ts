export interface DetailPageCopyInput {
  productName: string;
  category: string;
  material?: string;
  sellingPoints: string;
}

export interface DetailPageCopy {
  productName: string;
  hookCopy: string;
  highlights: string[]; // 특별한점, text only, no photo — count is configurable, see DEFAULT_HIGHLIGHT_COUNT
  // 01~03, each paired with a share of the uploaded photos — title is the first line (rendered
  // bold/larger), the rest of the pasted block becomes description.
  features: { number: string; title: string; description: string }[];
  closing: string;
}

// AI 문구생성 프롬프트 전체 — 사용자가 앱에서 직접 고쳐 쓴다(utils/detailPageCopyPrompt.ts).
// {상품명} 같은 자리표시자는 renderCopyPrompt가 실제 값으로 바꿔 넣는다.
//
// {응답형식}만 특별하다. 붙여넣기용(labels)일 때는 파서(parseDetailPageCopyText)가 읽는 라벨
// 형식으로, Gemini 직접 호출용(json)일 때는 개수 지시문으로 바뀐다 — 그쪽은 responseSchema가
// 모양을 잡으므로 라벨이 필요 없다. 이 자리표시자를 지우면 AI 답을 앱이 못 알아본다.
export const DEFAULT_COPY_PROMPT_TEMPLATE = [
  '아래 상품 정보를 참고해서 쇼핑몰 상세페이지 문구를 작성해줘.',
  '과장되거나 근거 없는 표현(효능 단정, 최상급 남발)은 피하고, 담백하면서도 매력적인 톤으로 써줘.',
  '',
  '상품명: {상품명}',
  '카테고리: {카테고리}',
  '소재: {소재}',
  '소구점 메모: {소구점}',
  '',
  '{응답형식}',
].join('\n');

// 화면에 안내로 띄우는 목록 — 여기 없는 자리표시자는 글자 그대로 남는다.
export const COPY_PROMPT_PLACEHOLDERS = [
  { token: '{상품명}', hint: '상품명' },
  { token: '{카테고리}', hint: '카테고리' },
  { token: '{소재}', hint: '소재 (비어 있으면 그 줄이 통째로 빠짐)' },
  { token: '{소구점}', hint: '소구점 메모' },
  { token: '{특별한점개수}', hint: '특별한점 개수' },
  { token: '{특징개수}', hint: '특징 블록 개수' },
  { token: '{응답형식}', hint: '답변 형식 — 지우면 붙여넣기가 동작하지 않음' },
];

// 특별한점(텍스트만) 섹션 개수 — 사진이 없는 항목이라 특징 블록 개수와 독립적. 앱에서 조절 가능(기본값/범위).
export const DEFAULT_HIGHLIGHT_COUNT = 4;
export const HIGHLIGHT_COUNT_MIN = 1;
export const HIGHLIGHT_COUNT_MAX = 8;
// 특징 01~0N(제목+설명+사진) 섹션 개수 — 업로드된 사진을 균등 분배하는 대상. 앱에서 조절 가능(기본값/범위).
export const DEFAULT_FEATURE_BLOCK_COUNT = 3;
export const FEATURE_BLOCK_COUNT_MIN = 1;
export const FEATURE_BLOCK_COUNT_MAX = 8;

function splitSellingPoints(sellingPoints: string): string[] {
  return sellingPoints
    .split(/[,\n·]/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Free, zero-cost fallback: fills a fixed sentence template with the product's own words.
// Quality is lower than an LLM (repetitive structure across products) but there's no API call.
export function generateDetailPageCopyTemplate(
  input: DetailPageCopyInput,
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): DetailPageCopy {
  const name = input.productName || '이 제품';
  const points = splitSellingPoints(input.sellingPoints);
  const point1 = points[0] || '뛰어난 만족감';
  const point2 = points[1] || '';

  const productName = name;
  const hookCopy = [point1, point2].filter(Boolean).join(', ');

  const highlightSeeds = [point1, point2, '꼼꼼한 마감과 검수', '합리적인 가격'].filter(Boolean);
  const highlights = Array.from({ length: highlightCount }, (_, i) => highlightSeeds[i] || `${name}만의 특별함`);

  const features = Array.from({ length: featureBlockCount }, (_, i) => {
    const point = points[i];
    return {
      number: String(i + 1).padStart(2, '0'),
      title: point || `${name}의 특징 ${i + 1}`,
      description: point ? `${point}을(를) 직접 경험해보세요.` : '세심하게 신경 쓴 디테일을 만나보세요.',
    };
  });

  const closing = `${name}, 지금 만나보세요.`;

  return { productName, hookCopy, highlights, features, closing };
}

// 붙여넣기용 답변 형식 — 라벨과 <사진> 표시, 줄 순서가 파서(parseDetailPageCopyText)가 읽는
// 규격 그 자체다. 개수만 설정을 따라간다.
export function buildLabelFormatBlock(
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): string {
  const lines: string[] = [
    '아래 형식을 절대 그대로 지켜서 답변해줘 (라벨과 <사진> 표시, 줄 순서를 바꾸지 말고, 라벨 다음 줄에 내용만 채워줘):',
    '',
    '제품명',
    '(제품명 한 줄)',
    '',
    '후킹 문구',
    '(임팩트 있는 문구. 반드시 두 줄로 나눠 쓰고, 한 줄은 18자를 넘기지 마)',
    '',
    '<사진>',
    '',
  ];
  for (let i = 1; i <= highlightCount; i++) {
    lines.push(`특별한점 ${String(i).padStart(2, '0')}`, '(짧은 특징 한 줄)', '');
  }
  for (let i = 1; i <= featureBlockCount; i++) {
    lines.push(String(i).padStart(2, '0'), '(특징 소제목 한 줄)', '', '(특징 설명 2~3문장)', '<사진>', '');
  }
  lines.push('마무리 문구', '(마무리 한 줄)');
  return lines.join('\n');
}

// Gemini를 직접 부를 때의 답변 형식. 모양은 responseSchema가 강제하므로(utils/detailPageCopyGemini.ts)
// 여기서는 개수만 알려주면 된다.
export function buildJsonFormatBlock(
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): string {
  return `highlights(특별한점, 짧은 한 줄 특징)는 정확히 ${highlightCount}개, features(제목+2~3문장 설명)는 정확히 ${featureBlockCount}개 작성해줘.`;
}

// 사용자가 고쳐 쓴 프롬프트에 실제 값을 채워 넣는다.
//  - 'labels': 외부 챗봇에 복사해 갈 프롬프트. 답을 parseDetailPageCopyText가 읽는다.
//  - 'json'  : Gemini 직접 호출용.
// {소재}가 든 줄은 소재가 비어 있으면 통째로 뺀다("소재: " 만 남는 줄을 AI에게 보내지 않으려고).
export function renderCopyPrompt(
  template: string,
  input: DetailPageCopyInput,
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
  format: 'labels' | 'json' = 'labels',
): string {
  const body = (template.trim() ? template : DEFAULT_COPY_PROMPT_TEMPLATE)
    .split('\n')
    .filter(line => !(line.includes('{소재}') && !input.material?.trim()))
    .join('\n');

  const formatBlock = format === 'labels'
    ? buildLabelFormatBlock(highlightCount, featureBlockCount)
    : buildJsonFormatBlock(highlightCount, featureBlockCount);

  return body
    .replace(/\{상품명\}/g, input.productName || '(미입력)')
    .replace(/\{카테고리\}/g, input.category || '(미입력)')
    .replace(/\{소재\}/g, input.material || '')
    .replace(/\{소구점\}/g, input.sellingPoints || '(미입력)')
    .replace(/\{특별한점개수\}/g, String(highlightCount))
    .replace(/\{특징개수\}/g, String(featureBlockCount))
    .replace(/\{응답형식\}/g, formatBlock)
    .trim();
}

const PHOTO_MARKER = '<사진>';

type FieldKey = 'productName' | 'hookCopy' | 'closing';
type Target = { kind: 'field'; key: FieldKey } | { kind: 'highlight' | 'feature'; index: number };

// Trailing part shared by every label: either "라벨:", "라벨 : 내용" (colon + inline content,
// half or full-width colon), or just "라벨" alone with nothing else on the line.
const LABEL_TAIL = '(?:\\s*[:：]\\s*(.*)|\\s*)$';
// \s* between every character so "후킹 문구" and "후킹문구" both match.
const FIELD_PATTERNS: { key: FieldKey; pattern: RegExp }[] = [
  { key: 'productName', pattern: new RegExp('^제\\s*품\\s*명' + LABEL_TAIL) },
  { key: 'hookCopy', pattern: new RegExp('^후\\s*킹\\s*문\\s*구' + LABEL_TAIL) },
  { key: 'closing', pattern: new RegExp('^마\\s*무\\s*리\\s*문\\s*구' + LABEL_TAIL) },
];
// No upper bound on the number — highlight count is configurable, so any digit index is accepted
// here and simply dropped later (in finalize) if it falls outside the current count.
const HIGHLIGHT_PATTERN = new RegExp('^특\\s*별\\s*한\\s*점\\s*0?(\\d+)' + LABEL_TAIL);
// No upper bound here either, same reasoning as HIGHLIGHT_PATTERN — the current featureBlockCount
// is enforced later in finalize(), so a pasted "05" still parses even if only 3 blocks are active.
const FEATURE_PATTERN = new RegExp('^0?(\\d+)' + LABEL_TAIL);

// AI 챗봇 답변에는 라벨을 그대로 써달라고 요청해도 마크다운 잡음(**굵게**, # 헤딩, -/·/번호
// 목록)이 섞여 오는 경우가 흔하다. 이 잡음 때문에 "특별한점 01" 같은 라벨을 못 알아보면 그
// 항목이 통째로 빈칸으로 저장돼버리므로, 라벨 인식 직전에만 걷어낸다(본문 내용 줄은 원문 그대로 둔다).
function stripMarkdownNoiseForLabelMatch(line: string): string {
  let s = line;
  s = s.replace(/^#{1,6}\s*/, '');
  s = s.replace(/^[-*•]\s+/, '');
  s = s.replace(/^\d+[.)]\s+/, '');
  const bold = s.match(/^\*\*(.*)\*\*$/) || s.match(/^__(.*)__$/);
  if (bold) s = bold[1];
  return s.trim();
}

// Recognizes a label line in any of: "라벨", "라벨:", "라벨: 내용", "라벨 : 내용" (spacing inside
// the label word itself is also ignored, so "후킹 문구" and "후킹문구" both match).
function matchLabelLine(rawLine: string): { target: Target; inline: string } | null {
  const line = stripMarkdownNoiseForLabelMatch(rawLine);
  for (const { key, pattern } of FIELD_PATTERNS) {
    const m = line.match(pattern);
    if (m) return { target: { kind: 'field', key }, inline: (m[1] || '').trim() };
  }
  const h = line.match(HIGHLIGHT_PATTERN);
  if (h) return { target: { kind: 'highlight', index: Number(h[1]) - 1 }, inline: (h[2] || '').trim() };
  const f = line.match(FEATURE_PATTERN);
  if (f) return { target: { kind: 'feature', index: Number(f[1]) - 1 }, inline: (f[2] || '').trim() };
  return null;
}

function applyTarget(result: DetailPageCopy, highlightBuf: string[], featureBuf: string[], target: Target, content: string) {
  if (target.kind === 'field') (result[target.key] as string) = content;
  else if (target.kind === 'highlight') highlightBuf[target.index] = content;
  else featureBuf[target.index] = content;
}

// The first line of a feature's block is its title (rendered bold/larger — see
// DetailPageBuilderModal), everything after the first line break is the description.
function splitFeatureBlock(content: string): { title: string; description: string } {
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx === -1) return { title: content, description: '' };
  return { title: content.slice(0, newlineIdx).trim(), description: content.slice(newlineIdx + 1).trim() };
}

function finalize(
  result: DetailPageCopy,
  highlightBuf: string[],
  featureBuf: string[],
  highlightCount: number,
  featureBlockCount: number,
): DetailPageCopy {
  result.highlights = Array.from({ length: highlightCount }, (_, i) => highlightBuf[i] || '');
  result.features = Array.from({ length: featureBlockCount }, (_, i) => i)
    .filter(i => (featureBuf[i] || '').trim())
    .map(i => ({ number: String(i + 1).padStart(2, '0'), ...splitFeatureBlock(featureBuf[i].trim()) }));
  return result;
}

function emptyCopy(): DetailPageCopy {
  return { productName: '', hookCopy: '', highlights: [], features: [], closing: '' };
}

// Parses the labeled format produced by buildLabelFormatBlock — and, just as importantly,
// what a user types by hand: "라벨: 내용" or "라벨" on its own line with the content below it,
// spacing inside the label word doesn't matter, and "<사진>" is a standalone marker that's
// simply skipped (photo placement follows upload order, not the pasted text).
function parseLabeled(text: string, highlightCount: number, featureBlockCount: number): DetailPageCopy {
  const result = emptyCopy();
  const highlightBuf: string[] = [];
  const featureBuf: string[] = [];
  let current: Target | null = null;
  let buffer: string[] = [];
  let matchedAny = false;

  const flush = () => {
    if (current) applyTarget(result, highlightBuf, featureBuf, current, buffer.join('\n').trim());
    buffer = [];
  };

  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (line === PHOTO_MARKER) return;
    const match = matchLabelLine(line);
    if (match) {
      matchedAny = true;
      flush();
      current = match.target;
      if (match.inline) buffer.push(match.inline);
      return;
    }
    buffer.push(raw);
  });
  flush();

  return matchedAny ? finalize(result, highlightBuf, featureBuf, highlightCount, featureBlockCount) : emptyCopy();
}

// Splits text into blocks separated by blank lines or "<사진>" marker lines, dropping the
// markers themselves (photo placement already follows upload order).
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) blocks.push(content);
    buffer = [];
  };
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (line === '' || line === PHOTO_MARKER) {
      flush();
      return;
    }
    buffer.push(raw);
  });
  flush();
  return blocks;
}

// Fallback for plain, unlabeled paste: takes blank-line-separated paragraphs in the exact
// template order (제품명 / 후킹 문구 / 특별한점 01~N / 01~03 / 마무리 문구).
function parsePositional(text: string, highlightCount: number, featureBlockCount: number): DetailPageCopy {
  const blocks = splitBlocks(text);
  let idx = 0;
  const next = () => blocks[idx++];
  const result = emptyCopy();
  result.productName = next() || '';
  result.hookCopy = next() || '';
  const highlightBuf = Array.from({ length: highlightCount }, () => next());
  const featureBuf = Array.from({ length: featureBlockCount }, () => next());
  result.closing = next() || '';
  return finalize(result, highlightBuf as string[], featureBuf as string[], highlightCount, featureBlockCount);
}

// 후킹 문구는 줄을 직접 나눠줘야 읽힌다. 그대로 두면 상자 너비에 맞춰 아무 데서나 접혀서
// 마지막 한두 글자만 다음 줄로 떨어진다("...한 권에 / 가지런히").
//
//  1) 문장이 끝나면(. ! ? ~) 줄을 바꾼다. 소수점("1.5")처럼 뒤에 공백이 없으면 건드리지 않는다.
//  2) 그러고도 줄이 길면 가운데에 가장 가까운 쉼표 뒤에서, 쉼표가 없으면 가운데에 가장 가까운
//     띄어쓰기에서 나눈다 — 두 줄의 길이가 엇비슷해야 보기 좋다.
//
// (문구 블록은 흰 공백을 그대로 살려 그리므로 \n이 그대로 줄바꿈이 된다.)
const MAX_HOOK_LINE = 18;

const splitLongLine = (line: string, depth = 0): string => {
  const text = line.trim();
  if (text.length <= MAX_HOOK_LINE || depth >= 2) return text;

  const middle = text.length / 2;
  const commas: number[] = [];
  const spaces: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === ',' || text[i] === '\u3001') commas.push(i + 1);
    else if (text[i] === ' ') spaces.push(i);
  }
  const nearestToMiddle = (list: number[]) =>
    list.reduce((best, cur) => (Math.abs(cur - middle) < Math.abs(best - middle) ? cur : best), list[0]);

  const at = commas.length > 0 ? nearestToMiddle(commas) : spaces.length > 0 ? nearestToMiddle(spaces) : -1;
  if (at <= 0) return text;
  return `${splitLongLine(text.slice(0, at), depth + 1)}\n${splitLongLine(text.slice(at), depth + 1)}`;
};

export const breakAfterSentences = (text: string): string =>
  text
    .replace(/([.!?~\u3002\uFF01\uFF1F]+)[ \t]+/g, '$1\n')
    .split('\n')
    .map(line => splitLongLine(line))
    .join('\n')
    .trim();

export function parseDetailPageCopyText(
  text: string,
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): DetailPageCopy {
  const labeled = parseLabeled(text, highlightCount, featureBlockCount);
  const hasLabeledContent =
    labeled.productName || labeled.hookCopy ||
    labeled.highlights.some(h => h.trim()) || labeled.features.length > 0 || labeled.closing;
  const parsed = hasLabeledContent ? labeled : parsePositional(text, highlightCount, featureBlockCount);
  return { ...parsed, hookCopy: breakAfterSentences(parsed.hookCopy) };
}
