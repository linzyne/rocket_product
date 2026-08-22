import { GoogleGenAI, Type } from "@google/genai";
import { DetailPageCopy, DetailPageCopyInput } from "./detailPageCopyTemplate";

// Direct in-editor generation: unlike buildDetailPageCopyPrompt (utils/detailPageCopyTemplate.ts),
// which the user copies out to an external chat AI and pastes the reply back in, this calls Gemini
// itself and asks for the exact DetailPageCopy shape via responseSchema — no label parsing needed.
export async function generateDetailPageCopyWithGemini(
  input: DetailPageCopyInput,
  highlightCount: number,
  featureBlockCount: number,
  styleInstruction?: string,
): Promise<DetailPageCopy> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = [
    '아래 상품 정보를 참고해서 쇼핑몰 상세페이지 문구를 작성해줘.',
    '과장되거나 근거 없는 표현(효능 단정, 최상급 남발)은 피하고, 담백하면서도 매력적인 톤으로 써줘.',
    '',
    `상품명: ${input.productName || '(미입력)'}`,
    `카테고리: ${input.category || '(미입력)'}`,
    input.material ? `소재: ${input.material}` : '',
    `소구점 메모: ${input.sellingPoints || '(미입력)'}`,
    '',
    `highlights(특별한점, 짧은 한 줄 특징)는 정확히 ${highlightCount}개, features(제목+2~3문장 설명)는 정확히 ${featureBlockCount}개 작성해줘.`,
    styleInstruction ? `추가 스타일/톤 지침: ${styleInstruction}` : '',
  ].filter(Boolean).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          productName: { type: Type.STRING },
          hookCopy: { type: Type.STRING },
          highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ['title', 'description'],
            },
          },
          closing: { type: Type.STRING },
        },
        required: ['productName', 'hookCopy', 'highlights', 'features', 'closing'],
      },
    },
  });

  const text = response.text?.trim();
  if (!text) throw new Error('AI 응답을 받지 못했습니다.');
  const parsed = JSON.parse(text);

  const highlights: string[] = Array.isArray(parsed.highlights) ? parsed.highlights.map((v: any) => String(v ?? '')) : [];
  const rawFeatures: any[] = Array.isArray(parsed.features) ? parsed.features : [];

  return {
    productName: String(parsed.productName ?? ''),
    hookCopy: String(parsed.hookCopy ?? ''),
    highlights: Array.from({ length: highlightCount }, (_, i) => highlights[i] || ''),
    features: rawFeatures.slice(0, featureBlockCount).map((f, i) => ({
      number: String(i + 1).padStart(2, '0'),
      title: String(f?.title ?? ''),
      description: String(f?.description ?? ''),
    })),
    closing: String(parsed.closing ?? ''),
  };
}
