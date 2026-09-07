
import { Product } from '../types';
import { customFieldNeedsUnit } from '../data/quoteTemplates';

// 견적서(carRcMapping)가 실제로 상품 데이터에서 읽어가는 항목들. 여기가 비어 있으면
// 견적서의 해당 칸도 빈 채로 채워지므로, 생성/다운로드 전에 미리 알려줍니다.
// (quantity처럼 비어 있어도 기본값으로 채워지는 항목, manufacturer처럼 고정값을 쓰는
// 항목, url/memo처럼 견적서에 쓰이지 않는 항목은 대상에서 제외합니다.)
const QUOTE_REQUIRED_FIELDS: { key: keyof Product; label: string }[] = [
  { key: 'category', label: '카테고리' },
  { key: 'productName', label: '상품명' },
  { key: 'color', label: '색상' },
  { key: 'searchKeyword', label: '검색어' },
  { key: 'sku', label: 'SKU' },
  { key: 'sizeWidth', label: '사이즈(가로)' },
  { key: 'sizeHeight', label: '사이즈(세로)' },
  { key: 'sizeDepth', label: '사이즈(높이)' },
  { key: 'weight', label: '중량' },
  { key: 'supplyPrice', label: '공급가' },
  { key: 'sellingPrice', label: '쿠팡판매가' },
  { key: 'thumbnailFile', label: '대표 이미지' },
  { key: 'detailFile', label: '상세 이미지' },
  { key: 'labelFile', label: '제품 필수 표시사항' },
];

export const getMissingFieldLabels = (product: Product): string[] => {
  const missing = QUOTE_REQUIRED_FIELDS
    .filter(({ key }) => !String(product[key] ?? '').trim())
    .map(({ label }) => label);

  // 견적서 카테고리별 추가 항목(노출속성)도 견적서에 그대로 실리는데, 비워 두거나 "30"처럼
  // 단위 없이 숫자만 적으면 등록이 반려됩니다. 상품 행에서 빨갛게 표시하고 있지만 지나치기
  // 쉬우므로, 견적서를 만들기 전에 여기서 한 번 더 알려줍니다.
  Object.entries<string>(product.customFields ?? {}).forEach(([name, value]) => {
    if (!value.trim()) missing.push(name);
    else if (customFieldNeedsUnit(value)) missing.push(`${name}(단위 없음)`);
  });

  return missing;
};

export interface ProductMissingFields {
  product: Product;
  missing: string[];
}

export const collectMissingFields = (products: Product[]): ProductMissingFields[] =>
  products
    .map(product => ({ product, missing: getMissingFieldLabels(product) }))
    .filter(({ missing }) => missing.length > 0);
