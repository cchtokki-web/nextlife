import type React from 'react';

// 모달 하단 버튼 행에 쓰는 스타일. 셋 다 flex: 1이라 `display:flex; gap:8px` 행에 나란히
// 놓이는 것을 전제한다.
//
// E2eeKeyManager에서 꺼내 왔다. 탈퇴 모달이 같은 생김새를 그대로 써야 하는데, 복사하면
// 한쪽만 고쳐졌을 때 같은 자리의 버튼 두 개가 서로 다르게 보인다.

export const primaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.75rem',
  backgroundColor: 'var(--primary, #3b82f6)',
  border: 'none',
  borderRadius: '10px',
  color: '#fff',
  fontSize: '0.9rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const secondaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.75rem',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--card-border, #334155)',
  borderRadius: '10px',
  color: 'var(--foreground, #fff)',
  fontSize: '0.9rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const dangerButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.75rem',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderRadius: '10px',
  color: '#EF4444',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
};
