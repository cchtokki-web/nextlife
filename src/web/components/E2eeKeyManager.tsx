import React, { useState } from 'react';
import { Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatBackupKey } from '../../core/utils/crypto';

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

interface E2eeKeyManagerProps {
  localKey: string | null;
  needsKeyRestore: boolean;
  isBackupKeyBackedUp: boolean;
  handleRestoreKey: (key: string) => Promise<boolean>;
  handleAcknowledgeBackup: () => void;
  onResetScenarios?: () => void;
  handleSendKeyToKakao?: (key: string) => Promise<{ success: boolean; error?: string }>;
  needsKeySetup?: boolean;
  handleSetupKey?: (key: string) => Promise<boolean>;
}

export const E2eeKeyManager: React.FC<E2eeKeyManagerProps> = ({
  localKey,
  needsKeyRestore,
  isBackupKeyBackedUp,
  handleRestoreKey,
  handleAcknowledgeBackup,
  onResetScenarios,
  handleSendKeyToKakao,
  needsKeySetup,
  handleSetupKey
}) => {
  const [copied, setCopied] = useState(false);
  const [pinInputs, setPinInputs] = useState<string[]>(['', '', '', '', '', '']);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSendingKakao, setIsSendingKakao] = useState(false);
  const [kakaoSentStatus, setKakaoSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 복구 실패 시도 제한 (온라인 브루트포스 억제용 speed bump)
  const MAX_RESTORE_ATTEMPTS = 5;
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

  React.useEffect(() => {
    if (needsKeyRestore) {
      setTimeout(() => {
        const firstInput = document.getElementById('pin-input-0');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  }, [needsKeyRestore]);

  React.useEffect(() => {
    if (needsKeySetup) {
      setTimeout(() => {
        const firstInput = document.getElementById('setup-pin-0');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  }, [needsKeySetup]);

  const performRestore = async (enteredKey: string) => {
    if (isRestoreLocked) return;
    setIsRestoring(true);
    const success = await handleRestoreKey(enteredKey);
    setIsRestoring(false);
    if (success) {
      setPinInputs(['', '', '', '', '', '']);
      setFailedRestoreAttempts(0);
    } else {
      setPinInputs(['', '', '', '', '', '']);
      const nextAttempts = failedRestoreAttempts + 1;
      if (nextAttempts >= MAX_RESTORE_ATTEMPTS) {
        setFailedRestoreAttempts(0);
        setRestoreLockedUntil(Date.now() + RESTORE_LOCKOUT_MS);
        alert(`보안 백업 키를 ${MAX_RESTORE_ATTEMPTS}회 잘못 입력했습니다. ${RESTORE_LOCKOUT_MS / 1000}초 후 다시 시도해 주세요.`);
      } else {
        setFailedRestoreAttempts(nextAttempts);
        alert(`보안 백업 키 복원에 실패했습니다. 키를 다시 확인해 주세요. (${nextAttempts}/${MAX_RESTORE_ATTEMPTS})`);
        setTimeout(() => {
          const firstInput = document.getElementById('pin-input-0');
          if (firstInput) firstInput.focus();
        }, 50);
      }
    }
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

  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [setupPinInputs, setSetupPinInputs] = useState<string[]>(['', '', '', '', '', '']);
  const [confirmPinInputs, setConfirmPinInputs] = useState<string[]>(['', '', '', '', '', '']);
  const [setupMismatches, setSetupMismatches] = useState<number>(0);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);

  const handleSetupPinChange = (index: number, value: string, isConfirm: boolean) => {
    const cleanVal = value.replace(/[^0-9]/g, '');
    const currentInputs = isConfirm ? confirmPinInputs : setupPinInputs;
    const setInputs = isConfirm ? setConfirmPinInputs : setSetupPinInputs;
    const prefix = isConfirm ? 'confirm-pin' : 'setup-pin';

    if (!cleanVal) {
      const newInputs = [...currentInputs];
      newInputs[index] = '';
      setInputs(newInputs);
      return;
    }

    const newInputs = [...currentInputs];
    if (cleanVal.length === 6) {
      for (let i = 0; i < 6; i++) {
        newInputs[i] = cleanVal[i] || '';
      }
      setInputs(newInputs);
      const lastInput = document.getElementById(`${prefix}-5`);
      if (lastInput) lastInput.focus();
      checkSetupStepAutoTrigger(newInputs, isConfirm);
      return;
    }

    newInputs[index] = cleanVal[cleanVal.length - 1];
    setInputs(newInputs);

    const enteredKey = newInputs.join('').trim();
    if (enteredKey.length === 6) {
      checkSetupStepAutoTrigger(newInputs, isConfirm);
      return;
    }

    if (index < 5) {
      const nextInput = document.getElementById(`${prefix}-${index + 1}`);
      if (nextInput) nextInput.focus();
    }
  };

  const handleSetupKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>, isConfirm: boolean) => {
    const currentInputs = isConfirm ? confirmPinInputs : setupPinInputs;
    const prefix = isConfirm ? 'confirm-pin' : 'setup-pin';
    if (e.key === 'Backspace' && !currentInputs[index] && index > 0) {
      const prevInput = document.getElementById(`${prefix}-${index - 1}`);
      if (prevInput) {
        prevInput.focus();
      }
    }
  };

  const checkSetupStepAutoTrigger = (inputs: string[], isConfirm: boolean) => {
    const entered = inputs.join('').trim();
    if (entered.length !== 6) return;

    if (!isConfirm) {
      setTimeout(() => {
        setSetupStep(2);
        setTimeout(() => {
          const firstConfirm = document.getElementById('confirm-pin-0');
          if (firstConfirm) firstConfirm.focus();
        }, 50);
      }, 300);
    } else {
      triggerSetupComplete(entered);
    }
  };

  const triggerSetupComplete = async (confirmKey: string) => {
    const primaryKey = setupPinInputs.join('').trim();
    if (primaryKey !== confirmKey) {
      setSetupError('보안키가 일치하지 않습니다. 다시 입력해 주세요.');
      setSetupMismatches(prev => prev + 1);
      setConfirmPinInputs(['', '', '', '', '', '']);
      setTimeout(() => {
        const firstConfirm = document.getElementById('confirm-pin-0');
        if (firstConfirm) firstConfirm.focus();
      }, 50);
      return;
    }

    if (!handleSetupKey) return;
    setIsSettingUp(true);
    setSetupError(null);
    const success = await handleSetupKey(primaryKey);
    setIsSettingUp(false);
    if (success) {
      // Alert removed for smoother user experience
    } else {
      alert('보안키 설정에 실패했습니다.');
    }
  };

  const handleSendKakao = async () => {
    if (!localKey || !handleSendKeyToKakao) return;
    setIsSendingKakao(true);
    setKakaoSentStatus('idle');
    const result = await handleSendKeyToKakao(localKey);
    setIsSendingKakao(false);
    if (result.success) {
      setKakaoSentStatus('success');
      setTimeout(() => setKakaoSentStatus('idle'), 3000);
    } else {
      setKakaoSentStatus('error');
      alert(result.error || '카카오톡 전송에 실패했습니다. 카카오 로그인을 확인해 주세요.');
      setTimeout(() => setKakaoSentStatus('idle'), 3000);
    }
  };

  const handleCopyKey = () => {
    if (!localKey) return;
    navigator.clipboard.writeText(localKey);
    setCopied(true);
    handleAcknowledgeBackup();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestoreLocked) return;
    const enteredKey = pinInputs.join('').trim().toUpperCase();
    if (enteredKey.length !== 6) {
      alert('6자리 보안 백업 키를 모두 입력해 주세요.');
      return;
    }
    await performRestore(enteredKey);
  };

  // 0. Setup key modal (Required for first-time login)
  if (needsKeySetup) {
    const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (setupStep === 1) {
        const entered = setupPinInputs.join('').trim();
        if (entered.length === 6) {
          setSetupStep(2);
          setTimeout(() => {
            const firstConfirm = document.getElementById('confirm-pin-0');
            if (firstConfirm) firstConfirm.focus();
          }, 50);
        }
      } else {
        const entered = confirmPinInputs.join('').trim();
        triggerSetupComplete(entered);
      }
    };

    return (
      <div style={{
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
      }}>
        <div style={{
          backgroundColor: 'var(--card-bg, #1e293b)',
          border: '1px solid var(--card-border, #334155)',
          borderRadius: '16px',
          maxWidth: '500px',
          width: '100%',
          padding: '2rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          color: 'var(--foreground, #f8fafc)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', color: 'var(--primary, #3b82f6)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>보안키 설정</h2>
          </div>
          
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--foreground-muted, #94a3b8)', marginBottom: '1.5rem' }}>
            은퇴 자산 데이터를 암호화하기 위해 <strong>숫자 6자리 보안키</strong>를 설정해 주세요.
            <br />
            설정 완료 시 카카오톡 나와의 채팅방으로 보안키가 전송됩니다.
          </p>

          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {setupStep === 1 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-muted)' }}>숫자 6자리 입력</label>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0' }}>
                  {[0, 1, 2, 3, 4, 5].map((idx) => (
                    <input
                      key={idx}
                      id={`setup-pin-${idx}`}
                      type="password"
                      maxLength={1}
                      value={setupPinInputs[idx]}
                      onChange={(e) => handleSetupPinChange(idx, e.target.value, false)}
                      onKeyDown={(e) => handleSetupKeyDown(idx, e, false)}
                      disabled={isSettingUp}
                      style={pinBoxStyle}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'; }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-muted)' }}>보안키 재입력 (확인)</label>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0' }}>
                  {[0, 1, 2, 3, 4, 5].map((idx) => (
                    <input
                      key={idx}
                      id={`confirm-pin-${idx}`}
                      type="password"
                      maxLength={1}
                      value={confirmPinInputs[idx]}
                      onChange={(e) => handleSetupPinChange(idx, e.target.value, true)}
                      onKeyDown={(e) => handleSetupKeyDown(idx, e, true)}
                      disabled={isSettingUp}
                      style={pinBoxStyle}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'; }}
                    />
                  ))}
                </div>
              </div>
            )}

            {setupError && (
              <div style={{ color: 'var(--danger, #EF4444)', fontSize: '0.8rem', textAlign: 'center', fontWeight: '500' }}>
                {setupError}
              </div>
            )}

            {isSettingUp && (
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
                <span>보안키 설정 중...</span>
              </div>
            )}

            {setupStep === 2 && setupMismatches >= 3 && (
              <button
                type="button"
                onClick={() => {
                  setSetupStep(1);
                  setSetupPinInputs(['', '', '', '', '', '']);
                  setConfirmPinInputs(['', '', '', '', '', '']);
                  setSetupMismatches(0);
                  setSetupError(null);
                  setTimeout(() => {
                    const firstInput = document.getElementById('setup-pin-0');
                    if (firstInput) firstInput.focus();
                  }, 50);
                }}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--card-border, #334155)',
                  borderRadius: '8px',
                  color: 'var(--foreground, #fff)',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '5px'
                }}
              >
                처음부터 입력
              </button>
            )}
          </form>
        </div>
      </div>
    );
  }

  // 1. Restore key modal (Required if decryption fails)
  if (needsKeyRestore) {
    return (
      <div style={{
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
      }}>
        <div style={{
          backgroundColor: 'var(--card-bg, #1e293b)',
          border: '1px solid var(--card-border, #334155)',
          borderRadius: '16px',
          maxWidth: '500px',
          width: '100%',
          padding: '2rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          color: 'var(--foreground, #f8fafc)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem', color: 'var(--foreground)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>보안키 입력</h2>
          </div>


          <form onSubmit={handleRestoreSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0' }}>
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <input
                    key={idx}
                    id={`pin-input-${idx}`}
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
                margin: '10px 0 20px 0',
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
                    <path d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z"/>
                  </svg>
                  보안키 안내
                </div>
                보안키는 최초 설정 및 로그인 시 회원님의 카카오톡 <strong>'나와의 채팅방'</strong>으로 자동 발송되었습니다. 카카오톡에서 <strong>'NextLife'</strong> 또는 <strong>'보안키'</strong>를 검색하여 확인해 주세요!
              </div>
            </div>

            {isRestoring && (
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
                <span>보안키 확인 및 데이터 조회 중...</span>
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
                margin: '10px 0',
                fontWeight: 600
              }}>
                <AlertTriangle size={16} />
                <span>너무 많이 틀렸습니다. {restoreLockRemaining}초 후 다시 시도해 주세요.</span>
              </div>
            )}

            {onResetScenarios && (
              <button
                type="button"
                onClick={onResetScenarios}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '10px',
                  color: '#EF4444',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '10px',
                  transition: 'all 0.2s'
                }}
              >
                모든 데이터 초기화 및 보안키 재설정
              </button>
            )}
          </form>

        </div>
      </div>
    );
  }


  return null;
};

export default E2eeKeyManager;
