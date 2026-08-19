
// 제조사 이름 끝에 "Co., Ltd."가 없으면 자동으로 붙여줍니다. 표기(대소문자, 쉼표/마침표 유무,
// 공백)가 조금 달라도 이미 붙어 있는 것으로 보고 중복으로 추가하지 않습니다.
export const withCoLtdSuffix = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/co\.,?\s*ltd\.?$/i.test(trimmed)) return trimmed;
  return `${trimmed} Co., Ltd.`;
};
