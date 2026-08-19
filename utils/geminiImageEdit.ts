import { GoogleGenAI } from "@google/genai";

export const BRUSH_ERASE_PROMPT =
  '이 이미지에서 형광 분홍색(마젠타)으로 칠해진 부분을 찾아서 자연스럽게 지워줘. 표시된 영역의 내용을 제거하고 주변 배경, 질감, 색상과 자연스럽게 이어지도록 인페인팅해줘. 분홍색 표시 자체도 완전히 사라져야 해. 표시되지 않은 나머지 부분은 원본 그대로 최대한 유지해줘. 이미지의 크기, 가로세로 비율, 구도, 확대/축소 비율은 입력 이미지와 완전히 동일하게 유지해줘 — 확대, 축소, 크롭, 재구성, 카메라 앵글 변경은 절대 하지 마. 결과물은 반드시 입력과 같은 프레이밍의 편집된 이미지여야 해.';

export async function editImageWithGemini(imageDataUrl: string, prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = imageDataUrl.split(',')[1];
  const mimeType = imageDataUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/png';

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        {
          text: prompt,
        },
      ],
    },
  });

  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error("이미지 결과물을 생성하지 못했습니다.");
}
