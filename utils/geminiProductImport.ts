import { GoogleGenAI, Type } from "@google/genai";

export interface ProductImportFields {
  manufacturerEn: string;
  keywords: string;
}

// 1688에서 붙여넣기 버튼을 누를 때 딱 1번만 호출됩니다(옵션이 몇 개든 자동/반복 호출 없음).
// 상품명/옵션명(색상)은 확장프로그램에서 이미 직접 한글로 입력해서 넘어오므로 번역하지 않고 원문
// 그대로 쓴다(App.tsx handleImportFrom1688 참고). 여기서는 원문이 중국어인 제조사만 번역하고,
// 검색어는 상품 1개에 대해 하나로 정해져야 하는 값이라 옵션마다 따로 호출하면 AI 응답이 매번
// 조금씩 달라지는 문제가 생겨 단일 호출로 일관된 값을 받는다.
export async function generateProductImportFields(
  rawTitle: string,
  rawManufacturer: string,
  rawColors: string[],
  category: string
): Promise<ProductImportFields> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const colorsList = rawColors.length > 0
    ? rawColors.map((c, i) => `${i + 1}. ${c || '(없음)'}`).join('\n')
    : '(없음)';

  const prompt = `아래는 1688(중국 도매 사이트)에서 가져온 상품 원본 정보입니다. 한국 오픈마켓(네이버 스마트스토어, 쿠팡 등) 판매자가 상품을 등록할 때 쓸 값으로 변환해줘. 상품명과 옵션(색상 등)은 참고용으로만 쓰고 번역 대상이 아니다(이미 한국어로 직접 입력된 값).

상품명(참고용, 번역 대상 아님): ${rawTitle || '(없음)'}
제조사/공급사 원문(중국어): ${rawManufacturer || '(없음)'}
옵션(색상 등, 참고용): ${colorsList}
카테고리: ${category || '(없음)'}

요구사항:
1. manufacturerEn: 제조사/공급사명을 영문 브랜드명처럼 표기. 지명(临沂 등)과 업종/법인 접미사(유한공사, 무역, 실업, 과기, 판매 등 "Co., Ltd." "Trading" "Sales" 류)는 빼고 핵심 브랜드명만 남긴다. 그 핵심 브랜드명은 병음 그대로 로마자 표기하지 말고, 한자 뜻을 살려 의미가 통하는 영문 단어/표현으로 의역한다(예: "满宇"처럼 뜻이 좋은 한자 조합이면 그 의미를 살린 "Wishing Star" 같은 이름으로). 뜻으로 자연스럽게 옮기기 어려운 경우에만 병음 로마자 표기를 대신 쓴다. 원문이 없으면 빈 문자열.
2. keywords: 이 상품을 한국에서 판매할 때 쓸 검색어(SEO 키워드) 20개를 쉼표로 구분한 하나의 문자열로. 실제 소비자가 검색할 법한 단어 위주(브랜드명 남용 금지, 너무 일반적인 단어 하나만 반복 금지). 옵션과 무관하게 상품 전체 기준으로 하나만 만든다.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          manufacturerEn: { type: Type.STRING },
          keywords: { type: Type.STRING },
        },
        required: ['manufacturerEn', 'keywords'],
      },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('AI 응답을 받지 못했습니다.');
  }

  const parsed = JSON.parse(text);

  return {
    manufacturerEn: parsed.manufacturerEn || '',
    keywords: parsed.keywords || '',
  };
}
