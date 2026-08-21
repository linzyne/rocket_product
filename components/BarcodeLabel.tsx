import React from 'react';
import { Product } from '../types';
import BarcodeImage from './BarcodeImage';
import { getProductQuoteTitle, getProductMaterialValue } from '../data/quoteTemplates';

interface BarcodeLabelProps {
  product: Product | null;
}

const BarcodeLabel = React.forwardRef<HTMLDivElement, BarcodeLabelProps>(({ product }, ref) => {
  if (!product) return null;

  const title = getProductQuoteTitle(product) || product.productName;
  const sizeParts = [product.sizeWidth, product.sizeHeight, product.sizeDepth].filter(Boolean);
  const sizeText = sizeParts.length ? `${sizeParts.join(' x ')}cm` : '';

  const infoLines = [
    { label: '수입자 / 제조사', value: [product.importer, product.manufacturer].filter(Boolean).join(' / ') },
    { label: '사이즈', value: sizeText },
    { label: '소재', value: getProductMaterialValue(product) },
    { label: '제조국', value: product.countryOfOrigin },
    { label: '사용연령', value: product.recommendedAge },
    { label: '주의사항', value: product.cautionNote },
  ];

  // Tailwind CDN(cdn.tailwindcss.com)은 처음 보는 arbitrary-value 클래스(text-[84px] 등)를
  // 스캔해서 즉석으로 CSS를 만들어 주입하는 방식이라, html2canvas가 캡처하는 시점까지 그 생성이
  // 끝나 있다는 보장이 없다(실제로 그래서 글자가 기본 크기로 작게 찍히는 문제가 있었다). 이
  // 컴포넌트는 크기가 곧 결과물이므로 폰트 크기/굵기/줄간격/여백을 전부 인라인 style로 직접
  // 지정해 어떤 외부 스타일시트 생성 타이밍에도 의존하지 않게 한다.
  return (
    <div
      ref={ref}
      style={{
        width: '1600px',
        padding: '16px',
        background: '#ffffff',
        color: '#000000',
        textAlign: 'left',
      }}
    >
      <h2 style={{ fontSize: '84px', fontWeight: 700, lineHeight: 1.15, margin: '0 0 64px 0', whiteSpace: 'nowrap' }}>
        {title || '-'}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '64px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {infoLines.map(({ label, value }) => (
            <p key={label} style={{ fontSize: '50px', fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap', margin: 0 }}>
              {label} : {value || '-'}
            </p>
          ))}
        </div>
        {product.barcode && (
          <div style={{ flexShrink: 0 }}>
            <BarcodeImage value={product.barcode} height={480} width={6} fontSize={44} />
          </div>
        )}
      </div>
    </div>
  );
});

export default BarcodeLabel;
