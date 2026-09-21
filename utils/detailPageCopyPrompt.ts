// AI 문구생성 설정 — 프롬프트 전문과 섹션 개수를 사용자가 직접 정해두는 곳.
//
// 같은 설정을 두 군데서 쓴다 — 앱의 상세페이지 에디터(문구생성하기 / AI용 프롬프트 복사하기)와,
// 1688 값 확인 창에 있는 확장의 "AI용 프롬프트 복사하기". 예전에는 같은 글과 개수(4/3)를 양쪽에
// 하드코딩해 둬서 한쪽만 고치면 어긋났으므로, 여기서 한 번 저장하고 확장에는 app-bridge.js를
// 통해 밀어 넣는다(확장은 chrome.storage.local에 받아둔다).
//
// 프롬프트는 전문을 고칠 수 있다. 다만 {응답형식} 자리에 들어가는 라벨 형식("제품명 / 후킹
// 문구 / 특별한점 01…")만은 붙여넣은 답을 파서가 그대로 읽어야 해서 앱이 만들어 넣는다.
import {
  DEFAULT_COPY_PROMPT_TEMPLATE,
  DEFAULT_FEATURE_BLOCK_COUNT,
  DEFAULT_HIGHLIGHT_COUNT,
  FEATURE_BLOCK_COUNT_MAX,
  FEATURE_BLOCK_COUNT_MIN,
  HIGHLIGHT_COUNT_MAX,
  HIGHLIGHT_COUNT_MIN,
} from './detailPageCopyTemplate';

export { DEFAULT_COPY_PROMPT_TEMPLATE };

export interface DetailCopySettings {
  /** 프롬프트 전문. {상품명}·{응답형식} 등 자리표시자는 renderCopyPrompt가 채운다. */
  template: string;
  highlightCount: number;
  featureBlockCount: number;
}

const STORAGE_KEY = 'detailPageCopySettings';
const APP_SOURCE = 'rocket-proposal-app';

export const DEFAULT_COPY_SETTINGS: DetailCopySettings = {
  template: DEFAULT_COPY_PROMPT_TEMPLATE,
  highlightCount: DEFAULT_HIGHLIGHT_COUNT,
  featureBlockCount: DEFAULT_FEATURE_BLOCK_COUNT,
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function loadCopySettings(): DetailCopySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_COPY_SETTINGS;
    const template = typeof parsed.template === 'string' && parsed.template.trim()
      ? parsed.template
      : DEFAULT_COPY_PROMPT_TEMPLATE;
    return {
      template,
      highlightCount: clamp(parsed.highlightCount, HIGHLIGHT_COUNT_MIN, HIGHLIGHT_COUNT_MAX, DEFAULT_HIGHLIGHT_COUNT),
      featureBlockCount: clamp(parsed.featureBlockCount, FEATURE_BLOCK_COUNT_MIN, FEATURE_BLOCK_COUNT_MAX, DEFAULT_FEATURE_BLOCK_COUNT),
    };
  } catch (error) {
    console.error('Failed to load detail page copy settings', error);
    return DEFAULT_COPY_SETTINGS;
  }
}

// 확장에 넘긴다. 확장이 없으면 이 메시지를 받는 쪽이 없을 뿐, 오류는 나지 않는다.
export function pushCopySettingsToExtension(settings: DetailCopySettings): void {
  try {
    window.postMessage({ source: APP_SOURCE, type: 'SET_COPY_SETTINGS', settings }, window.location.origin);
  } catch (error) {
    console.error('Failed to push detail page copy settings to extension', error);
  }
}

export function saveCopySettings(settings: DetailCopySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save detail page copy settings', error);
  }
  pushCopySettingsToExtension(settings);
}
