import { GoogleGenAI, Type } from "@google/genai";

export interface ProductImportFields {
  productNameKo: string;
  manufacturerEn: string;
  // rawColors와 같은 순서·같은 개수의 배열. 옵션(색상 등)이 여러 개여도 상품명/제조사/검색어는
  // 이 함수 호출 1번으로 통일해서 얻고, 옵션별로 다른 값은 이 배열로만 갈라진다.
  colorsKo: string[];
  keywords: string;
}

// 1688에서 붙여넣기 버튼을 누를 때 딱 1번만 호출됩니다(옵션이 몇 개든 자동/반복 호출 없음).
// 상품명/제조사/검색어는 옵션과 무관하게 상품 1개에 대해 하나로 정해져야 하는 값이라, 옵션마다
// 따로 호출하면 AI 응답이 매번 조금씩 달라져(같은 입력이어도) 상품행마다 다른 값이 들어가는
// 문제가 생긴다. 그래서 옵션 색상 목록을 한 번에 넘겨 단일 호출로 일관된 값을 받는다.
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

  const prompt = `아래는 1688(중국 도매 사이트)에서 가져온 상품 원본 정보입니다. 한국 오픈마켓(네이버 스마트스토어, 쿠팡 등) 판매자가 상품을 등록할 때 쓸 값으로 변환해줘.

상품명 원문(중국어): ${rawTitle || '(없음)'}
제조사/공급사 원문(중국어): ${rawManufacturer || '(없음)'}
옵션(색상 등) 원문(중국어) 목록 (번호 순서 그대로 유지):
${colorsList}
카테고리: ${category || '(없음)'}

요구사항:
1. productNameKo: 상품명을 자연스러운 한국어 판매용 상품명으로 번역/의역. 중국 지명, 사이트명, 무의미한 수식어는 빼고 핵심 특징 위주로. 옵션과 무관하게 이 상품 전체를 대표하는 이름 하나만 만든다.
2. manufacturerEn: 제조사/공급사명을 영문 브랜드명처럼 표기. 지명(临沂 등)과 업종/법인 접미사(유한공사, 무역, 실업, 과기, 판매 등 "Co., Ltd." "Trading" "Sales" 류)는 빼고 핵심 브랜드명만 남긴다. 그 핵심 브랜드명은 병음 그대로 로마자 표기하지 말고, 한자 뜻을 살려 의미가 통하는 영문 단어/표현으로 의역한다(예: "满宇"처럼 뜻이 좋은 한자 조합이면 그 의미를 살린 "Wishing Star" 같은 이름으로). 뜻으로 자연스럽게 옮기기 어려운 경우에만 병음 로마자 표기를 대신 쓴다. 원문이 없으면 빈 문자열.
3. colorsKo: 위 옵션 목록을 번호 순서 그대로, 같은 개수의 배열로 돌려주되 각각을 한국에서 흔히 쓰는 표현으로 번역(예: 红色→레드, 米白色→아이보리). 원문이 없는 항목은 빈 문자열.
4. keywords: 이 상품을 한국에서 판매할 때 쓸 검색어(SEO 키워드) 20개를 쉼표로 구분한 하나의 문자열로. 실제 소비자가 검색할 법한 단어 위주(브랜드명 남용 금지, 너무 일반적인 단어 하나만 반복 금지). 옵션과 무관하게 상품 전체 기준으로 하나만 만든다.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          productNameKo: { type: Type.STRING },
          manufacturerEn: { type: Type.STRING },
          colorsKo: { type: Type.ARRAY, items: { type: Type.STRING } },
          keywords: { type: Type.STRING },
        },
        required: ['productNameKo', 'manufacturerEn', 'colorsKo', 'keywords'],
      },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('AI 응답을 받지 못했습니다.');
  }

  const parsed = JSON.parse(text);
  const colorsKo: string[] = Array.isArray(parsed.colorsKo) ? parsed.colorsKo.map((v: any) => String(v ?? '')) : [];
  // AI가 개수를 어긋나게 돌려주는 드문 경우에 대비해, 부족한 자리는 원문 색상으로 채운다.
  while (colorsKo.length < rawColors.length) colorsKo.push(rawColors[colorsKo.length] || '');

  return {
    productNameKo: parsed.productNameKo || '',
    manufacturerEn: parsed.manufacturerEn || '',
    colorsKo,
    keywords: parsed.keywords || '',
  };
}
