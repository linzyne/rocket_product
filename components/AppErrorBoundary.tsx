import React from 'react';

// 화면 그리다 오류가 나면 React는 화면을 통째로 지워 하얗게 된다. 그 대신 무슨 오류인지와 새로고침 버튼을 보여 준다.
// 오류 문구는 그대로 복사해서 보내 주면 바로 고칠 수 있게 한다. 저장된 작업은 지우지 않는다.
interface State { error: Error | null; info: string }

export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[화면 오류]', error, info.componentStack);
    (this as any).setState({ info: (info.componentStack || '').split('\n').filter(Boolean).slice(0, 6).join('\n') });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return (this as any).props.children;
    const text = `${location.hash || '/'}\n${error.name}: ${error.message}\n${(error.stack || '').split('\n').slice(1, 6).join('\n')}\n${info}`;
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif', color: '#111' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>⛔ 화면에 오류가 났어요</div>
        <div style={{ fontSize: 14, color: '#555', marginBottom: 14 }}>저장된 작업은 그대로예요. 새로고침해 보고, 또 나오면 아래 글을 복사해서 보내 주세요.</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => location.reload()} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#e67e22', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>새로고침</button>
          <button onClick={() => navigator.clipboard.writeText(text).catch(() => {})} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>오류 글 복사</button>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f6f6f6', border: '1px solid #e5e5e5', borderRadius: 8, padding: 12, color: '#b91c1c' }}>{text}</pre>
      </div>
    );
  }
}
