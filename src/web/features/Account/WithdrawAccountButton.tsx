'use client';

import React, { useState } from 'react';
import { UserX, AlertTriangle } from 'lucide-react';
import { ModalShell } from '../../components/ui/ModalShell';
import { Spinner } from '../../components/ui/Spinner';
import { secondaryButtonStyle, dangerButtonStyle } from '../../components/ui/buttonStyles';
import type { WithdrawOutcome } from './useWithdrawAccount';
import { WITHDRAW_CONFIRM_PHRASE } from './useWithdrawAccount';

interface WithdrawAccountButtonProps {
  onWithdraw: () => Promise<WithdrawOutcome>;
  /** 무엇을 잃는지 구체적으로 보여 주기 위한 값. 모르면 문구에서 생략한다. */
  scenarioCount?: number;
  /** 헤더가 공유 hover 상태를 쓰고 싶을 때만. 없으면 컴포넌트가 스스로 관리한다. */
  hovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  className?: string;
  labelClassName?: string;
}

type Step = 'idle' | 'confirm' | 'deleting' | 'done';

export const WithdrawAccountButton: React.FC<WithdrawAccountButtonProps> = ({
  onWithdraw,
  scenarioCount,
  hovered,
  onHoverChange,
  className,
  labelClassName,
}) => {
  const [step, setStep] = useState<Step>('idle');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localHovered, setLocalHovered] = useState(false);

  const isHovered = hovered ?? localHovered;
  const setHovered = onHoverChange ?? setLocalHovered;

  // 완전 일치로 본다. includes였다면 IME 조합 중간 상태나 '탈퇴합니다' 같은 근접 문자열이
  // 버튼을 무장시킨다.
  const canDelete = phrase.trim() === WITHDRAW_CONFIRM_PHRASE;

  const close = () => {
    setStep('idle');
    setPhrase('');
    setError(null);
  };

  const submit = async () => {
    if (!canDelete) return;
    setStep('deleting');
    setError(null);
    const outcome = await onWithdraw();
    if (outcome.ok) {
      // 삭제에 성공한 페이지는 내비게이션을 기다리는 시체다. 여기서 상호작용 가능한 상태로
      // 돌아가면 그 요청 하나가(쿠키는 아직 살아 있다) 계정을 부활시킬 수 있다.
      setStep('done');
      return;
    }
    // 입력한 문구는 남긴다. 일시적인 네트워크 오류에 재입력을 요구할 이유가 없다.
    setError(outcome.message);
    setStep('confirm');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setStep('confirm')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label="회원 탈퇴"
        title="회원 탈퇴"
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.6rem 1.2rem',
          background: isHovered ? 'rgba(255, 77, 79, 0.1)' : 'var(--card-bg)',
          border: `1px solid ${isHovered ? 'var(--danger, #ff4d4f)' : 'var(--card-border)'}`,
          borderRadius: '12px',
          color: 'var(--danger, #ff4d4f)',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontWeight: 600,
          transition: 'all 0.2s ease',
          whiteSpace: 'nowrap',
        }}
      >
        <UserX size={16} />
        <span className={labelClassName}>회원 탈퇴</span>
      </button>

      {step === 'deleting' && (
        <ModalShell title="회원 탈퇴">
          <Spinner label="계정을 삭제하는 중..." />
        </ModalShell>
      )}

      {step === 'done' && (
        <ModalShell title="회원 탈퇴">
          <Spinner label="탈퇴 처리가 끝났습니다. 잠시만 기다려 주세요..." />
        </ModalShell>
      )}

      {step === 'confirm' && (
        <ModalShell title="회원 탈퇴" onDismiss={close}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#EF4444', marginBottom: '1rem' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
              탈퇴하면 다음이 즉시 삭제되며, 되돌릴 수 없습니다.
            </p>
          </div>

          <ul style={{
            fontSize: '0.85rem',
            lineHeight: 1.8,
            color: 'var(--foreground-muted, #94a3b8)',
            margin: '0 0 1rem 0',
            paddingLeft: '1.2rem',
          }}>
            <li>
              저장된 시나리오 전부
              {typeof scenarioCount === 'number' ? ` (${scenarioCount}개)` : ''}
            </li>
            <li>계정 정보 — 이메일 주소, 로그인 수단</li>
            <li>이 브라우저에 보관된 보안키</li>
          </ul>

          <p style={{
            fontSize: '0.8rem',
            lineHeight: 1.6,
            color: 'var(--foreground-muted, #94a3b8)',
            margin: '0 0 1.25rem 0',
            padding: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            borderRadius: '8px',
          }}>
            시나리오는 회원님의 보안키로 암호화되어 저장됩니다. <strong style={{ color: 'var(--foreground)' }}>운영자도 그 내용을 열어 볼 수 없고, 같은 이유로 탈퇴한 뒤에는 운영자도 되살려 드릴 수 없습니다.</strong> 기록이 필요하면 탈퇴를 취소하고 [결과 다운로드]로 PDF를 먼저 받아 두세요.
          </p>

          <label
            htmlFor="withdraw-confirm-input"
            style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px', fontWeight: 600 }}
          >
            계속하려면 아래에 <strong style={{ color: 'var(--danger, #ff4d4f)' }}>{WITHDRAW_CONFIRM_PHRASE}</strong>를 입력해 주세요.
          </label>
          <input
            id="withdraw-confirm-input"
            aria-label="탈퇴 확인 문구"
            type="text"
            value={phrase}
            autoFocus
            autoComplete="off"
            placeholder={WITHDRAW_CONFIRM_PHRASE}
            onChange={(e) => setPhrase(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '0.7rem',
              marginBottom: '1rem',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              color: 'var(--foreground)',
              fontSize: '1rem',
              outline: 'none',
            }}
          />

          {error && (
            <p role="alert" style={{ color: '#EF4444', fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 1rem 0', fontWeight: 500 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={close} style={secondaryButtonStyle}>
              취소
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canDelete}
              style={{
                ...dangerButtonStyle,
                opacity: canDelete ? 1 : 0.4,
                cursor: canDelete ? 'pointer' : 'not-allowed',
              }}
            >
              영구 삭제하고 탈퇴하기
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
};

export default WithdrawAccountButton;
