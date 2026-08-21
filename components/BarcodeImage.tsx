import React, { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeImageProps {
  value: string;
  height?: number;
  // 막대 하나(최소 폭)의 두께(px). 생략하면 height에 비례해 자동으로 정합니다. 라벨처럼 크게
  // 쓰는 경우 값을 키우면 막대가 굵어지고 바코드 전체 가로폭도 함께 넓어집니다.
  width?: number;
  // 바코드 아래 인쇄되는 숫자 크기. 생략하면 height에 비례해 자동으로 정합니다(작은 미리보기는
  // 작게, 라벨처럼 큰 바코드는 크게).
  fontSize?: number;
  className?: string;
}

// CODE128은 EAN-13과 달리 체크섬 검증 없이 임의의 숫자/문자를 그대로 인코딩할 수 있어,
// 사용자가 바코드 번호를 직접 수정해도(자동 생성된 13자리 숫자가 아니어도) 항상 렌더링됩니다.
const BarcodeImage: React.FC<BarcodeImageProps> = ({ value, height = 45, width, fontSize, className }) => {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!value.trim()) {
      setDataUrl('');
      return;
    }
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',
        height,
        width: width ?? Math.max(2, Math.round(height * 0.045)),
        displayValue: true,
        fontSize: fontSize ?? Math.max(10, Math.round(height * 0.3)),
        margin: 6,
      });
      setDataUrl(canvas.toDataURL('image/png'));
    } catch {
      setDataUrl('');
    }
  }, [value, height, width, fontSize]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt={value} className={className} />;
};

export default BarcodeImage;
