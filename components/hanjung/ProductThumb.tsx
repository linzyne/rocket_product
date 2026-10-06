import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, makeImageLookup } from '../../data/inventoryStore';

// 한중발주 화면의 상품 썸네일. 사진은 상품관리(쿠팡 광고 화면에서 모은 것)에서 상품이름으로 찾는다.
export function useProductImage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  useEffect(() => subscribeInventory(setItems), []);
  return useMemo(() => makeImageLookup(items), [items]);
}

const ProductThumb: React.FC<{ url: string; size?: number; title?: string }> = ({ url, size = 28, title }) => (
  <span
    title={title}
    className="inline-block flex-shrink-0 rounded border border-gray-200 bg-gray-50 overflow-hidden align-middle"
    style={{ width: size, height: size }}
  >
    {url && <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />}
  </span>
);

export default ProductThumb;
