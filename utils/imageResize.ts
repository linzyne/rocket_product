// 원본 이미지(data URL)를 지정한 최대 변의 길이로 축소한 JPEG data URL로 바꾼다.
// 상품목록(저장 게시판)처럼 클라우드(Firestore) 문서 크기 제한(1MB)이나 localStorage 용량이
// 걱정되는 곳에서, 원본 대신 작은 썸네일만 저장하기 위해 쓴다.
export const resizeImageDataUrl = (
  dataUrl: string,
  maxDimension: number = 160,
  quality: number = 0.7
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context를 만들 수 없습니다.'));
        return;
      }
      // 원본이 투명 배경(PNG)일 수 있으므로 JPEG로 저장하기 전에 흰 배경을 깔아준다.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('썸네일 리사이즈용 이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
};
