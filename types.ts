
export interface Product {
  id: string;
  url: string;
  memo: string;
  category: string;
  quoteTemplateId: string;
  productName: string;
  sku: string;
  barcode: string;
  costPrice: string;
  supplyPrice: string;
  sellingPrice: string;
  margin: string;
  color: string;
  quantity: string;
  searchKeyword: string;
  sizeWidth: string;
  sizeHeight: string;
  sizeDepth: string;
  // 한 개 단품 포장 사이즈. packageSizeSameAsProduct가 true면 sizeWidth/Height/Depth를 그대로
  // 조합해서 쓰고, false면 이 값을 직접 입력해서 씁니다(포장 후 사이즈가 상품 사이즈와 다른 경우).
  packageSize: string;
  packageSizeSameAsProduct: boolean;
  weight: string;
  manufacturer: string;
  material: string;
  countryOfOrigin: string;
  importer: string;
  recommendedAge: string;
  asContact: string;
  cautionNote: string;
  thumbnailFile: string;
  thumbnailDataUrl?: string;
  detailFile: string;
  detailDataUrl?: string;
  labelFile: string;
  labelDataUrl?: string;
  customFields: { [key: string]: string };
}

// 상품 게시판(등록 이력)에 보관되는 가벼운 스냅샷. 원본 이미지·엑셀 등 파일은 담지 않고
// url/상품명/가격 정보와 작게 리사이즈한 썸네일만 남겨서, 작업 중인 상품 목록이 삭제/초기화된
// 뒤에도 나중에 찾아볼 수 있게 한다.
export interface ArchivedProduct {
  id: string;
  savedAt: string;
  url: string;
  productName: string;
  costPrice: string;
  supplyPrice: string;
  sellingPrice: string;
  barcode: string;
  // 바코드 라벨(제품 필수 표시사항 + 바코드) 이미지를 상품목록에서도 그대로 다시 그려서 볼 수
  // 있도록, 라벨 구성에 필요한 값만 함께 저장한다.
  color: string;
  sizeWidth: string;
  sizeHeight: string;
  sizeDepth: string;
  material: string;
  countryOfOrigin: string;
  recommendedAge: string;
  cautionNote: string;
  importer: string;
  manufacturer: string;
  // 목록에서 한눈에 알아볼 수 있도록, 원본 대표 이미지를 작게 리사이즈한 썸네일만 함께 저장한다
  // (용량 때문에 원본은 저장하지 않음. utils/imageResize.ts 참고).
  thumbnailDataUrl?: string;
}

export interface ImageFile {
  id: string;
  file: File;
  previewUrl: string;
  newName: string;
}
