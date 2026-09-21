import { GoogleGenAI, Type } from "@google/genai";
import {
  DEFAULT_COPY_PROMPT_TEMPLATE,
  DetailPageCopy,
  DetailPageCopyInput,
  breakAfterSentences,
  renderCopyPrompt,
} from "./detailPageCopyTemplate";

// Direct in-editor generation: unlike the 'labels' rendering (utils/detailPageCopyTemplate.ts),
// which the user copies out to an external chat AI and pastes the reply back in, this calls Gemini
// itself and asks for the exact DetailPageCopy shape via responseSchema — no label parsing needed.
// 프롬프트 본문은 같은 템플릿을 쓰되 {응답형식}만 'json'으로 렌더링한다.
export async function generateDetailPageCopyWithGemini(
  input: DetailPageCopyInput,
  highlightCount: number,
  featureBlockCount: number,
  styleInstruction?: string,
  // 사용자가 앱에서 고쳐 쓴 프롬프트 전문(utils/detailPageCopyPrompt.ts). 안 넘기면 기본값.
  template: string = DEFAULT_COPY_PROMPT_TEMPLATE,
): Promise<DetailPageCopy> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // 'json' 형식: 라벨 대신 개수 지시문만 들어간다(모양은 아래 responseSchema가 강제한다).
  const prompt = [
    renderCopyPrompt(template, input, highlightCount, featureBlockCount, 'json'),
    styleInstruction ? `\n추가 스타일/톤 지침: ${styleInstruction}` : '',
  ].filter(Boolean).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      // gemini-2.5-flash의 기본 thinking(내부 추론) 토큰도 출력 단가로 과금되므로 꺼서 호출당
      // 비용을 줄인다(utils/geminiProductImport.ts와 동일한 이유).
      thinkingConfig: { thinkingBudget: 0 },
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
    // 후킹 문구는 문장이 끝나면 줄을 바꿔야 상자 너비에 맞춰 엉뚱한 데서 접히지 않는다.
    hookCopy: breakAfterSentences(String(parsed.hookCopy ?? '')),
    highlights: Array.from({ length: highlightCount }, (_, i) => highlights[i] || ''),
    features: rawFeatures.slice(0, featureBlockCount).map((f, i) => ({
      number: String(i + 1).padStart(2, '0'),
      title: String(f?.title ?? ''),
      description: String(f?.description ?? ''),
    })),
    closing: String(parsed.closing ?? ''),
  };
}
