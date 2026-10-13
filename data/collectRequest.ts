// 다른 화면(왼쪽 메뉴 등)에서 수집 화면에 "이것들 차례로 돌려 줘"를 부탁한다.
// 수집 화면이 아직 안 열렸으면 남겨 두었다가 열릴 때 가져가고, 열려 있으면 바로 알린다.
export type CollectStepId = 'po' | 'receive' | 'stock';
const EVENT = 'rocket-collect-request';
let pending: CollectStepId[] | null = null;

export const requestCollect = (steps: CollectStepId[]) => {
  pending = steps;
  window.dispatchEvent(new Event(EVENT));
};

export const takeCollectRequest = (): CollectStepId[] | null => {
  const steps = pending;
  pending = null;
  return steps;
};

export const onCollectRequest = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};
