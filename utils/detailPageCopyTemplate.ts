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

// Builds a copy-pasteable prompt for an external chat AI (ChatGPT, Gemini web, etc.) — the user
// pastes the AI's reply back into parseDetailPageCopyText below. No API call from this app.
// The requested format uses plain Korean labels (no bracket tags) plus literal "<사진>" markers,
// matching exactly what a user would type by hand — see parseDetailPageCopyText.
export function buildDetailPageCopyPrompt(
  input: DetailPageCopyInput,
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): string {
  const lines: string[] = [
    '아래 상품 정보를 참고해서 쇼핑몰 상세페이지 문구를 작성해줘.',
    '과장되거나 근거 없는 표현(효능 단정, 최상급 남발)은 피하고, 담백하면서도 매력적인 톤으로 써줘.',
    '',
    `상품명: ${input.productName || '(미입력)'}`,
    `카테고리: ${input.category || '(미입력)'}`,
  ];
  if (input.material) lines.push(`소재: ${input.material}`);
  lines.push(`소구점 메모: ${input.sellingPoints || '(미입력)'}`, '');
  lines.push(
    '아래 형식을 절대 그대로 지켜서 답변해줘 (라벨과 <사진> 표시, 줄 순서를 바꾸지 말고, 라벨 다음 줄에 내용만 채워줘):',
    '',
    '제품명',
    '(제품명 한 줄)',
    '',
    '후킹 문구',
    '(임팩트 있는 한 줄)',
    '',
    '<사진>',
    ''
  );
  for (let i = 1; i <= highlightCount; i++) {
    lines.push(`특별한점 ${String(i).padStart(2, '0')}`, '(짧은 특징 한 줄)', '');
  }
  for (let i = 1; i <= featureBlockCount; i++) {
    lines.push(String(i).padStart(2, '0'), '(특징 소제목 한 줄)', '', '(특징 설명 2~3문장)', '<사진>', '');
  }
  lines.push('마무리 문구', '(마무리 한 줄)');
  return lines.join('\n');
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

// Recognizes a label line in any of: "라벨", "라벨:", "라벨: 내용", "라벨 : 내용" (spacing inside
// the label word itself is also ignored, so "후킹 문구" and "후킹문구" both match).
function matchLabelLine(line: string): { target: Target; inline: string } | null {
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

// Parses the labeled format produced by buildDetailPageCopyPrompt — and, just as importantly,
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

export function parseDetailPageCopyText(
  text: string,
  highlightCount: number = DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: number = DEFAULT_FEATURE_BLOCK_COUNT,
): DetailPageCopy {
  const labeled = parseLabeled(text, highlightCount, featureBlockCount);
  const hasLabeledContent =
    labeled.productName || labeled.hookCopy ||
    labeled.highlights.some(h => h.trim()) || labeled.features.length > 0 || labeled.closing;
  return hasLabeledContent ? labeled : parsePositional(text, highlightCount, featureBlockCount);
}
