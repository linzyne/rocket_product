
export interface Product {
  id: string;
  url: string;
  memo: string;
  category: string;
  quoteTemplateId: string;
  productName: string;
  sku: string;
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
  countryOfOrigin: string;
  importer: string;
  recommendedAge: string;
  asContact: string;
  thumbnailFile: string;
  thumbnailDataUrl?: string;
  detailFile: string;
  detailDataUrl?: string;
  labelFile: string;
  labelDataUrl?: string;
  customFields: { [key: string]: string };
}

export interface ImageFile {
  id: string;
  file: File;
  previewUrl: string;
  newName: string;
}
