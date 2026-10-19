import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';

// 새로 배포되면 옛 화면이 지워진 파일을 불러오다 실패한다(예: 쉽먼트 출력의 PDF 합치기). 그때 한 번 새로고침한다.
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('reloadedForDeploy') || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem('reloadedForDeploy', String(Date.now()));
  } catch {}
  alert('새 버전이 나와서 화면을 새로고침할게요. 새로고침 뒤 다시 눌러 주세요.');
  window.location.reload();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);