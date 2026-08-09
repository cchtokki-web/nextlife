import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { KeyNotice } from '../features/Scenario/useScenarios';
// 배럴(ui/index.ts)을 경유하지 않는다 — 거기서 Collapse/Tooltip/GLOSSARY까지 딸려 온다.
import { ModalShell } from './ui/ModalShell';
import { Spinner } from './ui/Spinner';
import { primaryButtonStyle, secondaryButtonStyle, dangerButtonStyle } from './ui/buttonStyles';

// 잠금/쿨다운 해제 시각. Date.now()는 같은 입력에 다른 값을 주는 impure 호출이라 컴파일러가
// 렌더 경로에서 부르는 것을 막는다. 실제로는 이벤트 핸들러에서만 부르지만 컴파일러가
// 그 경로를 따라가지 못하므로, 모듈 스코프로 빼 의도를 분명히 한다.
function lockoutDeadline(durationMs: number): number {
  return Date.now() + durationMs;
}

// 어두운 모달 배경(--card-bg) 위에서도 박스 경계가 뚜렷이 보이도록 배경/테두리 대비를 높게 잡는다.
const pinBoxStyle: React.CSSProperties = {
  width: '45px',
  height: '45px',
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  border: '1.5px solid rgba(255, 255, 255, 0.3)',
  borderRadius: '8px',
  color: 'var(--foreground)',
  fontSize: '18px',
  fontWeight: 'bold',
  textAlign: 'center',
  outline: 'none',
};

const RETRY_COOLDOWN_MS = 30000;

interface E2eeKeyManagerProps {
  // 발급 안내 (최초 발급 — 신규 가입 또는 키를 받은 적 없는 기존 계정 / 초기화 후 재발급 /
  // 백업 미확인)
  keyNotice?: KeyNotice | null;
  onAcknowledgeKey?: () => void;
  onRetrySendKey?: () => Promise<{ success: boolean; error?: string }>;

  // 복구
  needsKeyRestore: boolean;
  handleRestoreKey: (key: string) => Promise<boolean>;
  restoreError?: string | null;
  onResetScenarios?: () => Promise<void> | void;
  // 서버는 잠긴 계정이라는데 대조할 암호문이 없는 상태. 맞는 키를 넣어도 검증이 불가능하므로
  // 실패 횟수를 기다리지 않고 탈출구를 연다.
  restoreUnverifiable?: boolean;
}

export const E2eeKeyManager: React.FC<E2eeKeyManagerProps> = ({
  keyNotice,
  onAcknowledgeKey,
  onRetrySendKey,
  needsKeyRestore,
  handleRestoreKey,
  restoreError,
  onResetScenarios,
  restoreUnverifiable = false,
}) => {
  const [pinInputs, setPinInputs] = useState<string[]>(['', '', '', '', '', '']);
  const [isRestoring, setIsRestoring] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // 복구 실패 시도 제한.
  //
  // 카운터는 단조 증가한다. 예전에는 잠금이 걸릴 때 0으로 되돌렸는데, 초기화 버튼이 같은
  // 카운터를 읽는 지금 그렇게 하면 3·4회에 열렸던 탈출구가 5회에 다시 닫힌다 — 가장 필요한
  // 순간에 사라지는 셈이다.
  const RESET_UNLOCK_ATTEMPTS = 3;   // 초기화 버튼이 열리는 실패 횟수
  const MAX_RESTORE_ATTEMPTS = 5;    // 이 횟수마다 잠금
  const RESTORE_LOCKOUT_MS = 30000;
  const [failedRestoreAttempts, setFailedRestoreAttempts] = useState(0);
  const [restoreLockedUntil, setRestoreLockedUntil] = useState<number | null>(null);
  const [restoreLockRemaining, setRestoreLockRemaining] = useState(0);

  React.useEffect(() => {
    if (!restoreLockedUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((restoreLockedUntil - Date.now()) / 1000));
      setRestoreLockRemaining(remaining);
      if (remaining <= 0) {
        setRestoreLockedUntil(null);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [restoreLockedUntil]);

  const isRestoreLocked = restoreLockedUntil !== null && restoreLockRemaining > 0;
  // 검증할 암호문이 없는 계정에서는 실패 횟수를 채울 이유가 없다. 맞는 키를 세 번 넣어
  // "틀렸다"는 거짓말을 세 번 듣고서야 탈출구가 열리는 것을 막는다.
  const canReset = restoreUnverifiable || failedRestoreAttempts >= RESET_UNLOCK_ATTEMPTS;

  React.useEffect(() => {
    if (needsKeyRestore) {
      setTimeout(() => {
        const firstInput = document.getElementById('pin-input-0');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  }, [needsKeyRestore]);

  const performRestore = async (enteredKey: string) => {
    if (isRestoreLocked) return;
    setIsRestoring(true);
    setLocalError(null);
    const success = await handleRestoreKey(enteredKey);
    setIsRestoring(false);
    setPinInputs(['', '', '', '', '', '']);
    if (success) {
      setFailedRestoreAttempts(0);
      return;
    }

    const nextAttempts = failedRestoreAttempts + 1;
    setFailedRestoreAttempts(nextAttempts);
    if (nextAttempts % MAX_RESTORE_ATTEMPTS === 0) {
      setRestoreLockedUntil(lockoutDeadline(RESTORE_LOCKOUT_MS));
      setLocalError(`보안키를 ${nextAttempts}회 잘못 입력했습니다. ${RESTORE_LOCKOUT_MS / 1000}초 후 다시 시도할 수 있습니다.`);
      return;
    }

    setLocalError(
      nextAttempts < RESET_UNLOCK_ATTEMPTS
        ? `보안키가 올바르지 않습니다. (${nextAttempts}/${RESET_UNLOCK_ATTEMPTS}) ${RESET_UNLOCK_ATTEMPTS}회 실패하면 데이터를 초기화하고 새 보안키를 받을 수 있습니다.`
        : '보안키가 올바르지 않습니다. 아래에서 데이터를 초기화하고 새 보안키를 받을 수 있습니다.'
    );
    setTimeout(() => {
      const firstInput = document.getElementById('pin-input-0');
      if (firstInput) firstInput.focus();
    }, 50);
  };

  const handlePinChange = (index: number, value: string) => {
    const cleanVal = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanVal) {
      const newInputs = [...pinInputs];
      newInputs[index] = '';
      setPinInputs(newInputs);
      return;
    }

    const newInputs = [...pinInputs];
    if (cleanVal.length === 6) {
      for (let i = 0; i < 6; i++) {
        newInputs[i] = cleanVal[i] || '';
      }
      setPinInputs(newInputs);
      const lastInput = document.getElementById(`pin-input-5`);
      if (lastInput) lastInput.focus();

      const enteredKey = newInputs.join('').trim().toUpperCase();
      if (enteredKey.length === 6) {
        performRestore(enteredKey);
      }
      return;
    }

    newInputs[index] = cleanVal[cleanVal.length - 1];
    setPinInputs(newInputs);

    const enteredKey = newInputs.join('').trim().toUpperCase();
    if (enteredKey.length === 6) {
      performRestore(enteredKey);
      return;
    }

    if (index < 5) {
      const nextInput = document.getElementById(`pin-input-${index + 1}`);
      if (nextInput) nextInput.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinInputs[index] && index > 0) {
      const prevInput = document.getElementById(`pin-input-${index - 1}`);
      if (prevInput) {
        prevInput.focus();
      }
    }
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestoreLocked) return;
    const enteredKey = pinInputs.join('').trim().toUpperCase();
    if (enteredKey.length !== 6) {
      setLocalError('6자리 보안키를 모두 입력해 주세요.');
      return;
    }
    await performRestore(enteredKey);
  };

  // 0. 보안키 발급 안내 — 확인을 누르기 전까지 앱으로 진입하지 않는다.
  if (keyNotice) {
    return (
      <IssuedKeyNotice
        notice={keyNotice}
        onAcknowledge={onAcknowledgeKey}
        onRetrySend={onRetrySendKey}
      />
    );
  }

  // 1. 보안키 입력 — 서버는 잠긴 계정이라는데 이 브라우저에 키가 없거나(다른 기기/시크릿 창),
  // 가진 키로 복호화가 실패했을 때.
  if (needsKeyRestore) {
    const message = localError || restoreError;
    return (
      <ModalShell title="보안키 입력">
        <form onSubmit={handleRestoreSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0' }}>
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <input
                key={idx}
                id={`pin-input-${idx}`}
                aria-label={`보안키 ${idx + 1}번째 자리`}
                type="password"
                maxLength={1}
                value={pinInputs[idx]}
                onChange={(e) => handlePinChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                disabled={isRestoring || isRestoreLocked}
                style={{ ...pinBoxStyle, textTransform: 'uppercase' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'; }}
              />
            ))}
          </div>

          <div style={{
            backgroundColor: 'rgba(254, 229, 0, 0.08)',
            border: '1px solid rgba(254, 229, 0, 0.2)',
            borderRadius: '8px',
            padding: '12px',
            fontSize: '0.75rem',
            lineHeight: '1.5',
            color: 'var(--foreground-muted, #ccc)',
            textAlign: 'left'
          }}>
            <div style={{
              fontWeight: 'bold',
              color: 'var(--kakaotalk-text-color, #FEE500)',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.8rem'
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z" />
              </svg>
              보안키 안내
            </div>
            보안키는 <strong>이 기능을 처음 쓰게 된 시점</strong>(가입 직후, 예전에 가입한 계정이라면 보안 강화 이후 첫 로그인, 또는 데이터 초기화로 새 키를 발급받았을 때) 회원님의 카카오톡 <strong>&lsquo;나와의 채팅방&rsquo;</strong>으로 1회 발송되었습니다. 로그인할 때마다 다시 보내드리지 않으니, 카카오톡에서 <strong>&lsquo;NextLife&rsquo;</strong> 또는 <strong>&lsquo;보안키&rsquo;</strong>를 검색해 지난 메시지를 확인해 주세요.
          </div>

          {isRestoring && <Spinner label="보안키 확인 및 데이터 조회 중..." />}

          {message && (
            <div role="alert" style={{
              color: '#EF4444',
              fontSize: '0.8rem',
              lineHeight: 1.5,
              fontWeight: 500,
              textAlign: 'left'
            }}>
              {message}
            </div>
          )}

          {isRestoreLocked && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              color: '#EF4444',
              fontSize: '0.85rem',
              fontWeight: 600
            }}>
              <AlertTriangle size={16} />
              <span>너무 많이 틀렸습니다. {restoreLockRemaining}초 후 다시 시도해 주세요.</span>
            </div>
          )}

          {onResetScenarios && (
            <ResetScenariosControl canReset={canReset} onResetScenarios={onResetScenarios} />
          )}
        </form>
      </ModalShell>
    );
  }

  return null;
};

// 데이터 초기화 버튼. 3회 실패 전에는 보이되 비활성이라 "탈출구가 있다"는 사실은 알 수 있다.
//
// 잠금(isRestoreLocked)은 이 버튼을 막지 않는다. 막으면 키를 모르는 사용자가 30초 동안
// 할 수 있는 일이 하나도 없다.
const ResetScenariosControl: React.FC<{
  canReset: boolean;
  onResetScenarios: () => Promise<void> | void;
}> = ({ canReset, onResetScenarios }) => {
  const [confirming, setConfirming] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  if (isResetting) return <Spinner label="데이터를 초기화하고 새 보안키를 발급하는 중..." />;

  if (!confirming) {
    return (
      <div style={{ marginTop: '4px' }}>
        <button
          type="button"
          disabled={!canReset}
          onClick={() => setConfirming(true)}
          style={{
            ...dangerButtonStyle,
            width: '100%',
            opacity: canReset ? 1 : 0.4,
            cursor: canReset ? 'pointer' : 'not-allowed',
          }}
        >
          모든 데이터 초기화 및 새 보안키 발급
        </button>
        {!canReset && (
          <p style={{ fontSize: '0.7rem', color: 'var(--foreground-muted, #94a3b8)', margin: '6px 0 0 0', textAlign: 'center' }}>
            보안키를 3회 잘못 입력하면 사용할 수 있습니다.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontSize: '0.8rem', lineHeight: 1.5, color: '#EF4444', margin: 0, textAlign: 'left', fontWeight: 500 }}>
        새 보안키가 발급되고, 지금 보안키로 열 수 없는 시나리오는 삭제됩니다. 되돌릴 수 없습니다.
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" onClick={() => setConfirming(false)} style={secondaryButtonStyle}>
          취소
        </button>
        <button
          type="button"
          onClick={async () => {
            setIsResetting(true);
            try {
              await onResetScenarios();
            } finally {
              setIsResetting(false);
            }
          }}
          style={dangerButtonStyle}
        >
          삭제하고 새 키 받기
        </button>
      </div>
    </div>
  );
};

// 발급된 보안키 안내. 전송에 성공했으면 키를 화면에 띄우지 않고(카카오톡에만 남긴다),
// 실패했으면 키를 보여 주고 직접 기록하게 한다.
const IssuedKeyNotice: React.FC<{
  notice: KeyNotice;
  onAcknowledge?: () => void;
  onRetrySend?: () => Promise<{ success: boolean; error?: string }>;
}> = ({ notice, onAcknowledge, onRetrySend }) => {
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  React.useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining <= 0) setCooldownUntil(null);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const isCoolingDown = cooldownUntil !== null && cooldownRemaining > 0;

  if (notice.status === 'sending') {
    return (
      <ModalShell title="보안키 발급 중">
        <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--foreground-muted, #94a3b8)', margin: '0 0 1rem 0' }}>
          보안키를 발급해 카카오톡으로 보내는 중입니다.
        </p>
        <Spinner label="전송 중..." />
      </ModalShell>
    );
  }

  if (notice.status === 'sent') {
    return (
      <ModalShell title="보안키를 보내드렸습니다">
        <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--foreground-muted, #94a3b8)', margin: '0 0 1.5rem 0' }}>
          회원님의 카카오톡 <strong style={{ color: 'var(--foreground)' }}>&lsquo;나와의 채팅방&rsquo;</strong>으로 보안키를 보내드렸습니다.
          <br />
          기기를 바꾸거나 브라우저 데이터를 지웠을 때 이 키가 있어야 자산 데이터를 다시 열 수 있으니,
          메시지를 지우지 말고 보관해 주세요.
        </p>
        <button type="button" onClick={onAcknowledge} style={{ ...primaryButtonStyle, width: '100%' }}>
          확인
        </button>
      </ModalShell>
    );
  }

  // failed / unbacked — 두 경우 모두 "카카오톡에 키가 남아 있다고 확신할 수 없는" 상태다.
  const title = notice.status === 'failed' ? '카카오톡 전송에 실패했습니다' : '보안키 백업이 확인되지 않았습니다';
  const reason = notice.status === 'failed' ? notice.error : undefined;

  return (
    <ModalShell title={title}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#EF4444', marginBottom: '1rem' }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
        <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
          {reason ? `${reason} ` : ''}아래 보안키를 반드시 다른 곳에 기록해 주세요. 분실하면 저장된 자산 데이터를 복구할 수 없습니다.
        </p>
      </div>

      {/* 입력 요소가 아니라 텍스트로 렌더한다 — input이면 비밀번호 관리자와 자동완성의 수집 대상이 된다. */}
      <div style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '1.75rem',
        fontWeight: 700,
        letterSpacing: '0.35em',
        textAlign: 'center',
        padding: '1rem',
        margin: '0 0 1.25rem 0',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid var(--card-border, #334155)',
        borderRadius: '10px',
        color: 'var(--foreground, #f8fafc)',
      }}>
        {notice.key}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {onRetrySend && (
          <button
            type="button"
            disabled={isCoolingDown}
            onClick={async () => {
              setCooldownUntil(lockoutDeadline(RETRY_COOLDOWN_MS));
              await onRetrySend();
            }}
            style={{
              ...secondaryButtonStyle,
              opacity: isCoolingDown ? 0.5 : 1,
              cursor: isCoolingDown ? 'not-allowed' : 'pointer',
            }}
          >
            {isCoolingDown ? `다시 보내기 (${cooldownRemaining}초)` : '다시 보내기'}
          </button>
        )}
        <button type="button" onClick={onAcknowledge} style={primaryButtonStyle}>
          기록했습니다
        </button>
      </div>
    </ModalShell>
  );
};

export default E2eeKeyManager;
