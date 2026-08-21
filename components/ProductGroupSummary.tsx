
import React from 'react';
import { Product } from '../types';
import { ImageIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';

interface ProductGroupSummaryProps {
  groupIndex: number;
  products: Product[];
  isExpanded: boolean;
  onToggle: () => void;
}

const formatNumber = (value: string | number) => Number(value || 0).toLocaleString();

const ProductGroupSummary: React.FC<ProductGroupSummaryProps> = ({ groupIndex, products, isExpanded, onToggle }) => {
  const lead = products[0];
  const thumbnail = products.find(p => p.thumbnailDataUrl)?.thumbnailDataUrl;
  const optionCount = products.length;
  const costPrices = products
    .map(p => Number(p.costPrice))
    .filter(n => Number.isFinite(n) && n > 0);
  const minCost = costPrices.length > 0 ? Math.min(...costPrices) : null;
  const maxCost = costPrices.length > 0 ? Math.max(...costPrices) : null;
  const colors = Array.from(new Set(products.map(p => p.color.trim()).filter(Boolean)));

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-lg hover:border-gray-300 hover:bg-gray-100 transition-colors duration-150 text-left"
      aria-expanded={isExpanded}
    >
      <span className="flex-shrink-0 w-6 text-center text-sm font-semibold text-gray-500">{groupIndex}</span>
      <span className="flex-shrink-0 text-gray-400">
        {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </span>

      <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-md flex items-center justify-center overflow-hidden border border-gray-200 text-gray-400">
        {thumbnail ? (
          <img src={thumbnail} alt={lead.productName} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {lead.productName || '상품명 없음'}
          </span>
          {lead.category && (
            <span className="text-xs text-gray-400 truncate flex-shrink-0">{lead.category}</span>
          )}
        </div>
        {colors.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {colors.map(color => (
              <span
                key={color}
                className="px-1.5 py-0.5 text-[10px] leading-none rounded bg-gray-50 text-gray-700 border border-gray-200"
              >
                {color}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-900 text-xs font-semibold whitespace-nowrap">
          옵션 {optionCount}개
        </span>
        {minCost !== null && (
          <span className="font-mono text-xs text-emerald-700 whitespace-nowrap">
            {minCost === maxCost ? `${formatNumber(minCost)}원` : `${formatNumber(minCost)}~${formatNumber(maxCost!)}원`}
          </span>
        )}
      </div>
    </button>
  );
};

export default React.memo(ProductGroupSummary);
