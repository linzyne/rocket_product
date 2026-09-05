import React, { useEffect, useRef, useState } from 'react';
import { toEditableHtml, isRichTextBlank } from '../utils/richText';

interface EditableTextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style: React.CSSProperties;
}

// 미리보기 안에서 바로 고쳐 쓰는 문구 블록. 값은 간단한 HTML로 오간다(utils/richText.ts 참고) —
// 드래그로 고른 일부 글자만 색·크기·굵기를 바꿀 수 있어야 해서다.
//
// DOM을 React가 매 렌더마다 다시 그리지 않는다(=비제어). 타이핑 중에 innerHTML을 덮어쓰면 커서가
// 맨 앞으로 튀기 때문에, 값이 바깥에서 바뀌었고 지금 편집 중이 아닐 때만 DOM에 반영한다.
export const EditableText: React.FC<EditableTextProps> = ({ value, onChange, placeholder, style }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const next = toEditableHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    // 글자를 다 지웠을 때 contentEditable이 남기는 <br>/빈 태그는 빈 값으로 정리해서 넘긴다.
    onChange(isRichTextBlank(el.innerHTML) ? '' : el.innerHTML);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        // 서식 툴바가 DOM을 직접 손본 뒤 input 이벤트를 쏘면 여기로 들어와 값이 저장된다.
        onInput={commit}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        style={{ ...style, outline: 'none', whiteSpace: 'pre-wrap', cursor: 'text', minHeight: '1.2em' }}
      />
      {!focused && isRichTextBlank(value) && (
        <div data-html2canvas-ignore="true" style={{ ...style, position: 'absolute', inset: 0, color: '#94a3b8', pointerEvents: 'none' }}>
          {placeholder}
        </div>
      )}
    </div>
  );
};

export default EditableText;
