import React from 'react';
import { Product } from '../types';
import BarcodeImage from './BarcodeImage';
import { getProductMaterialValue } from '../data/quoteTemplates';

interface ProductLabelProps {
  product: Product | null;
}

const ProductLabel = React.forwardRef<HTMLDivElement, ProductLabelProps>(({ product }, ref) => {
  if (!product) return null;

  const size = [product.sizeWidth, product.sizeHeight, product.sizeDepth].filter(Boolean).join(' x ');

  const labelData = [
    { label: '제품명', value: product.productName },
    { label: '제조국', value: product.countryOfOrigin || 'Made in China' },
    { label: '수입사', value: product.importer || '주노엘' },
    { label: '제조사', value: product.manufacturer },
    { label: '소재', value: getProductMaterialValue(product) },
    { label: '사용연령', value: product.recommendedAge || '만14세이상' },
    { label: '사이즈(MM)', value: size },
    { label: 'A/S', value: product.asContact || '주노엘 01048629452' },
  ];

  return (
    <div ref={ref} className="p-10 bg-white font-sans" style={{ width: '650px' }}>
      <h2 className="text-4xl font-bold text-center mb-10 tracking-wider text-black">제품상세설명</h2>
      <div className="border-t-2 border-black">
        {labelData.map((item, index) => (
          <div key={index} className="flex text-lg border-b border-gray-200">
            <div className="w-40 p-4 font-bold text-gray-800 flex items-center shrink-0">{item.label}</div>
            <div className="flex-1 p-4 text-gray-700 flex items-center break-words">{item.value || '-'}</div>
          </div>
        ))}
      </div>
      {product.barcode && (
        <div className="mt-6 flex justify-center">
          <BarcodeImage value={product.barcode} height={55} />
        </div>
      )}
      <p className="mt-6 text-sm text-gray-600 text-center">
        제품 이상 시 공정거래위원회 고시 소비자분쟁해결기준에 의거 보상합니다.
      </p>
    </div>
  );
});

export default ProductLabel;