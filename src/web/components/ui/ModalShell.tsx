import React, { useEffect, useId } from 'react';

// 모달 껍데기. 컴포넌트 본문 안에 두면 렌더마다 타입 정체성이 새로 생겨 자식이 리마운트되고,
// 입력 도중 포커스가 날아간다. 반드시 모듈 스코프여야 한다.
//
// (E2eeKeyManager 안에 있던 것을 꺼내 왔다. 파일이 나뉘었으니 이 제약은 오히려 더 중요하다 —
//  여기 코드를 컴포넌트 안으로 옮기고 싶어지는 사람이 원래 맥락을 모른 채 들어올 수 있다.)
export const ModalShell: React.FC<{
  title: string;
  children: React.ReactNode;
  // 닫을 수 있는 모달에만 준다. 보안키 발급/복구 모달은 "닫으면 앱에 못 들어가는" 게이트라
  // 의도적으로 주지 않는다 — Escape나 배경 클릭으로 빠져나가면 안 된다.
  onDismiss?: () => void;
}> = ({ title, children, onDismiss }) => {
  const titleId = useId();

  useEffect(() => {
    if (!onDismiss) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        padding: '1rem'
      }}
      // 배경을 눌렀을 때만 닫는다. 카드 안쪽 클릭이 버블링으로 올라와 모달을 닫으면
      // 입력 중에 창이 사라진다.
      onMouseDown={onDismiss ? (e) => { if (e.target === e.currentTarget) onDismiss(); } : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          backgroundColor: 'var(--card-bg, #1e293b)',
          border: '1px solid var(--card-border, #334155)',
          borderRadius: '16px',
          maxWidth: '500px',
          width: '100%',
          padding: '2rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          color: 'var(--foreground, #f8fafc)'
        }}
      >
        <h2 id={titleId} style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 1.25rem 0' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
};

export default ModalShell;
