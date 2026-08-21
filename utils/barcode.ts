// 내부 재고관리/출력용 바코드 번호를 생성합니다. EAN-13 규격에서 앞자리 200~299는
// 유통(POS) 코드와 겹치지 않도록 매장/사내 전용으로 예약된 범위라 여기서 사용합니다.
// (쿠팡 등 마켓플레이스 등록용 공식 바코드는 별도로 발급받아야 합니다.)
const calculateEan13CheckDigit = (first12: number[]): number => {
  const sum = first12.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
};

export const generateBarcodeNumber = (): string => {
  const first12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  first12[0] = 2;
  return [...first12, calculateEan13CheckDigit(first12)].join('');
};
