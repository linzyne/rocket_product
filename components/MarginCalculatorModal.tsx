
import React, { useState, useEffect, useCallback } from 'react';
import { CloseIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';

interface MarginCalculatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { costPrice: string; supplyPrice: string; sellingPrice: string; margin: string; }) => void;
}

const CNY_BASE_RATE_DEFAULT = 210;
const CNY_RATE_STORAGE_KEY = 'cnyExchangeRate';
const FEE_RATE = 0.1; // 10% intermediate fee
const VAT_RATE = 0.1; // 10%
const COMPREHENSIVE_INCOME_TAX_RATE = 0.06; // Lowest bracket
const LOCAL_INCOME_TAX_RATE = 0.1; // 10% of comprehensive tax

// Excel's ROUNDUP(number, -2) equivalent
const roundupToNearest100 = (num: number): number => {
    if (isNaN(num) || !isFinite(num)) return 0;
    return Math.ceil(num / 100) * 100;
};


const MarginCalculatorModal: React.FC<MarginCalculatorModalProps> = ({ isOpen, onClose, onSave }) => {
    const [cny, setCny] = useState('');
    const [krw, setKrw] = useState(0);
    const [exchangeRate, setExchangeRate] = useState(() => {
        const saved = localStorage.getItem(CNY_RATE_STORAGE_KEY);
        const parsed = saved ? parseFloat(saved) : NaN;
        return !isNaN(parsed) && parsed > 0 ? parsed.toString() : CNY_BASE_RATE_DEFAULT.toString();
    });
    const [supplyMarginPercent, setSupplyMarginPercent] = useState('');
    const [sellingMarginPercent, setSellingMarginPercent] = useState('');
    const [isTaxDetailsVisible, setIsTaxDetailsVisible] = useState(false);

    const exchangeRateValue = parseFloat(exchangeRate) || 0;

    useEffect(() => {
        if (exchangeRateValue > 0) {
            localStorage.setItem(CNY_RATE_STORAGE_KEY, exchangeRateValue.toString());
        }
    }, [exchangeRateValue]);

    useEffect(() => {
        const cnyValue = parseFloat(cny);
        if (!isNaN(cnyValue) && cnyValue > 0 && exchangeRateValue > 0) {
            const costInKrw = cnyValue * exchangeRateValue;
            const costWithFee = costInKrw * (1 + FEE_RATE);
            const calculatedKrw = Math.round(costWithFee * (1 + VAT_RATE));
            setKrw(calculatedKrw);
        } else {
            setKrw(0);
        }
    }, [cny, exchangeRateValue]);

    const supplyMarginValue = parseFloat(supplyMarginPercent);
    const supplyPrice = !isNaN(supplyMarginValue) && supplyMarginValue < 100 && krw > 0
        ? roundupToNearest100(krw / (1 - supplyMarginValue / 100))
        : 0;
    
    const sellingMarginValue = parseFloat(sellingMarginPercent);
    const sellingPrice = !isNaN(sellingMarginValue) && sellingMarginValue < 100 && supplyPrice > 0
        ? roundupToNearest100(supplyPrice / (1 - sellingMarginValue / 100))
        : 0;
    const sellingMarginAmount = sellingPrice > 0 && supplyPrice > 0 ? sellingPrice - supplyPrice : 0;
    
    // VAT and Margin Calculations
    const inputVat = krw > 0 ? Math.round(krw - (krw / (1 + VAT_RATE))) : 0;
    const outputVat = supplyPrice > 0 ? Math.round(supplyPrice - (supplyPrice / (1 + VAT_RATE))) : 0;
    const vatPayable = outputVat > inputVat ? outputVat - inputVat : 0;
    const grossMargin = supplyPrice > 0 ? supplyPrice - krw : 0;
    const marginAfterVat = grossMargin - vatPayable;

    // Comprehensive Income Tax Calculation
    const effectiveIncomeTaxRate = COMPREHENSIVE_INCOME_TAX_RATE * (1 + LOCAL_INCOME_TAX_RATE);
    const comprehensiveIncomeTax = marginAfterVat > 0 ? Math.round(marginAfterVat * effectiveIncomeTaxRate) : 0;
    const netProfit = marginAfterVat - comprehensiveIncomeTax;


    const handleSave = useCallback(() => {
        onSave({
            costPrice: krw.toString(),
            supplyPrice: supplyPrice.toString(),
            sellingPrice: sellingPrice.toString(),
            margin: netProfit.toString(),
        });
    }, [onSave, krw, supplyPrice, sellingPrice, netProfit]);
    
    const resetState = useCallback(() => {
        setCny('');
        setKrw(0);
        setSupplyMarginPercent('');
        setSellingMarginPercent('');
        setIsTaxDetailsVisible(false);
    }, []);

    useEffect(() => {
        if (isOpen) {
            resetState();
        }
    }, [isOpen, resetState]);


    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4 transition-opacity duration-300" onClick={onClose}>
            <div className="bg-slate-800 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 relative transform transition-all duration-300 scale-95" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
                    <CloseIcon />
                </button>
                <h2 className="text-2xl font-bold text-slate-100 mb-6">수익 계산기</h2>
                
                <div className="space-y-4">
                    {/* Exchange Rate Input */}
                    <div>
                        <label htmlFor="exchange-rate-input" className="block text-sm font-medium text-slate-300 mb-1">적용 환율 (1위안 = ?원)</label>
                        <div className="relative">
                            <input
                                id="exchange-rate-input"
                                type="number"
                                value={exchangeRate}
                                onChange={(e) => setExchangeRate(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={`예: ${CNY_BASE_RATE_DEFAULT}`}
                            />
                            <span className="absolute inset-y-0 right-3 flex items-center text-slate-400">원</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">여기서 입력한 환율은 다음에 열 때도 그대로 유지됩니다.</p>
                    </div>

                    {/* CNY Input */}
                    <div>
                        <label htmlFor="cny-input" className="block text-sm font-medium text-slate-300 mb-1">위안 (CNY)</label>
                        <div className="relative">
                            <input
                                id="cny-input"
                                type="number"
                                value={cny}
                                onChange={(e) => setCny(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="예: 10"
                                autoFocus
                            />
                            <span className="absolute inset-y-0 right-3 flex items-center text-slate-400">¥</span>
                        </div>
                    </div>

                    {/* KRW Display */}
                    <div className="p-3 bg-slate-700 rounded-md">
                        <span className="text-sm font-medium text-slate-400">환산 원가 (KRW, VAT 포함)</span>
                        <p className="text-2xl font-bold text-blue-400 mt-1">₩ {krw.toLocaleString()}</p>
                        <p className="text-xs text-slate-500">계산식: ((위안 × {exchangeRateValue || CNY_BASE_RATE_DEFAULT}원) + 수수료 10%) + VAT 10%</p>
                    </div>

                    {/* Supply Margin Input */}
                    <div>
                        <label htmlFor="supply-margin-input" className="block text-sm font-medium text-slate-300 mb-1">공급 마진율 (%)</label>
                        <div className="relative">
                            <input
                                id="supply-margin-input"
                                type="number"
                                value={supplyMarginPercent}
                                onChange={(e) => setSupplyMarginPercent(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="예: 30 (100 미만)"
                            />
                            <span className="absolute inset-y-0 right-3 flex items-center text-slate-400">%</span>
                        </div>
                         <p className="text-xs text-slate-400 mt-1">공급가에서 이 비율만큼 마진이 남도록 계산하며, 100원 단위로 올림 처리됩니다.</p>
                        <p className="text-lg font-semibold text-slate-200 mt-2">계산된 공급가: <span className="text-emerald-400">₩ {supplyPrice.toLocaleString()}</span></p>
                    </div>

                    {/* Selling Margin Input */}
                    <div>
                        <label htmlFor="selling-margin-input" className="block text-sm font-medium text-slate-300 mb-1">판매 마진율 (공급가 대비 %)</label>
                        <div className="relative">
                            <input
                                id="selling-margin-input"
                                type="number"
                                value={sellingMarginPercent}
                                onChange={(e) => setSellingMarginPercent(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="예: 50 (100 미만)"
                            />
                            <span className="absolute inset-y-0 right-3 flex items-center text-slate-400">%</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">판매가에서 이 비율만큼 마진이 남도록 계산하며, 100원 단위로 올림 처리됩니다.</p>
                        <p className="text-lg font-semibold text-slate-200 mt-2">계산된 판매가: <span className="text-emerald-400">₩ {sellingPrice.toLocaleString()}</span></p>
                        <p className="text-sm font-medium text-slate-300 mt-1">판매가 - 공급가: <span className="text-amber-400">₩ {sellingMarginAmount.toLocaleString()}</span></p>
                    </div>

                    {/* Tax Details Toggle */}
                    <div className="pt-2">
                        <button
                            onClick={() => setIsTaxDetailsVisible(!isTaxDetailsVisible)}
                            className="w-full flex justify-between items-center text-left p-2 rounded-md bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-colors"
                        >
                            <span className="font-semibold text-slate-300">세금 정보 상세 보기</span>
                            {isTaxDetailsVisible ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        </button>
                    </div>

                    {/* Collapsible Tax Details */}
                    {isTaxDetailsVisible && (
                        <div className="p-3 border border-slate-600 rounded-md space-y-4 bg-slate-700/50 animate-fade-in">
                            {/* VAT Info */}
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-slate-200">부가세 정보 (참고용)</h3>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">매출세액 (공급가 부가세)</span>
                                    <span className="font-medium text-slate-100">₩ {outputVat.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">매입세액 (원가 부가세)</span>
                                    <span className="font-medium text-slate-100">₩ {inputVat.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2 border-slate-600">
                                    <span className="text-red-400">납부 예상 부가세</span>
                                    <span className="text-red-400">₩ {vatPayable.toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-slate-500 pt-2">
                                    실제 부가세는 세무 기준에 따라 달라질 수 있으므로, 반드시 세무 전문가와 상담하세요.
                                </p>
                            </div>
                            
                            {/* Comprehensive Income Tax Info */}
                            <div className="pt-2 border-t border-slate-600 space-y-2">
                                <h3 className="text-sm font-semibold text-slate-200">종합소득세 정보 (참고용)</h3>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">과세 대상 소득</span>
                                    <span className="font-medium text-slate-100">₩ {marginAfterVat.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm font-bold">
                                    <span className="text-orange-400">예상 종합소득세</span>
                                    <span className="text-orange-400">₩ {comprehensiveIncomeTax.toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-slate-500 pt-1">
                                    과세표준 1,400만원 이하 최저세율 6.6% (지방소득세 포함) 적용 기준입니다. 실제 소득세는 개인의 총 소득 및 공제 항목에 따라 크게 달라질 수 있습니다.
                                </p>
                            </div>
                        </div>
                    )}

                    
                    {/* Final Margin & Net Profit Display */}
                    <div className="p-4 bg-slate-700 rounded-md text-left space-y-2">
                         <div className="flex justify-between text-sm">
                            <span className="font-medium text-slate-400">마진 (공급가 - 원가)</span>
                            <span className="font-medium text-slate-100">₩ {grossMargin.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="font-medium text-slate-400">납부 예상 부가세</span>
                            <span className="font-medium text-red-400">- ₩ {vatPayable.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="font-medium text-slate-400">예상 종합소득세</span>
                            <span className="font-medium text-orange-400">- ₩ {comprehensiveIncomeTax.toLocaleString()}</span>
                        </div>
                        
                        <div className="border-t border-slate-600 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-lg font-bold text-slate-100">최종 순수익 (예상)</span>
                            <p className="text-2xl font-bold text-green-400">₩ {netProfit.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
                        닫기
                    </button>
                    <button onClick={handleSave} disabled={krw <= 0 || supplyPrice <= 0} className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed">
                        저장하고 적용하기
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MarginCalculatorModal;
