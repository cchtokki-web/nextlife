import React from 'react';
import { RefreshCw } from 'lucide-react';

// 모달 안에서 "지금 뭔가 진행 중"을 알리는 표시. 버튼 자리를 통째로 이것으로 바꾸면
// 이중 제출이 구조적으로 불가능해진다 — E2eeKeyManager의 초기화 흐름이 쓰는 방식이다.
export const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--primary, #3b82f6)',
    fontSize: '0.9rem',
    margin: '10px 0',
    fontWeight: 600
  }}>
    <RefreshCw style={{ animation: 'spin 1s linear infinite' }} size={16} />
    <span>{label}</span>
  </div>
);

export default Spinner;
