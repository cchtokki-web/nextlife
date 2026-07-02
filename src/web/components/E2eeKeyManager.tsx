import React, { useState } from 'react';
import { Key, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatBackupKey } from '../../core/utils/crypto';

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
      return;
    }

    newInputs[index] = cleanVal[cleanVal.length - 1];
    setPinInputs(newInputs);

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

  const [setupKeyInput, setSetupKeyInput] = useState('');
  const [setupKeyConfirmInput, setSetupKeyConfirmInput] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);

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
    const enteredKey = pinInputs.join('').trim().toUpperCase();
    if (enteredKey.length !== 6) {
      alert('6자리 보안 백업 키를 모두 입력해 주세요.');
      return;
    }
    setIsRestoring(true);
    const success = await handleRestoreKey(enteredKey);
    setIsRestoring(false);
    if (success) {
      alert('보안 백업 키가 성공적으로 복원되었습니다.');
      setPinInputs(['', '', '', '', '', '']);
    } else {
      alert('보안 백업 키 복원에 실패했습니다. 키를 다시 확인해 주세요.');
    }
  };

  // 0. Setup key modal (Required for first-time login)
  if (needsKeySetup) {
    const handleSetupSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const p1 = setupKeyInput.trim();
      const p2 = setupKeyConfirmInput.trim();
      if (p1.length !== 6 || !/^\d+$/.test(p1)) {
        alert('보안 비밀번호는 숫자 6자리여야 합니다.');
        return;
      }
      if (p1 !== p2) {
        alert('입력하신 두 비밀번호가 일치하지 않습니다.');
        return;
      }
      if (!handleSetupKey) return;
      setIsSettingUp(true);
      const success = await handleSetupKey(p1);
      setIsSettingUp(false);
      if (success) {
        alert('보안 비밀번호가 성공적으로 설정되었습니다! 시나리오 저장을 위해 데이터 종단간 암호화(E2EE)가 활성화되었습니다.');
      } else {
        alert('비밀번호 설정에 실패했습니다.');
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
            <Key size={28} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>데이터 보안 비밀번호 설정</h2>
          </div>
          
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--foreground-muted, #94a3b8)', marginBottom: '1.5rem' }}>
            은퇴 자산 시뮬레이션 데이터를 안전하게 암호화하기 위해 **숫자 6자리 보안 비밀번호**를 설정해 주세요.
            <br />
            이 비밀번호는 서버에 절대 저장되지 않으므로, 기기를 변경하거나 데이터를 복구할 때를 위해 반드시 기억해 두어야 합니다.
          </p>

          <form onSubmit={handleSetupSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-muted)' }}>숫자 6자리 입력</label>
              <input
                type="password"
                maxLength={6}
                pattern="\d{6}"
                placeholder="숫자 6자리 입력 (예: 123456)"
                value={setupKeyInput}
                onChange={(e) => setSetupKeyInput(e.target.value.replace(/\D/g, ''))}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                  fontSize: '0.9rem',
                  fontFamily: 'monospace',
                  letterSpacing: '0.5em',
                  textAlign: 'center',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-muted)' }}>비밀번호 확인 입력</label>
              <input
                type="password"
                maxLength={6}
                pattern="\d{6}"
                placeholder="동일하게 한 번 더 입력"
                value={setupKeyConfirmInput}
                onChange={(e) => setSetupKeyConfirmInput(e.target.value.replace(/\D/g, ''))}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                  fontSize: '0.9rem',
                  fontFamily: 'monospace',
                  letterSpacing: '0.5em',
                  textAlign: 'center',
                  outline: 'none'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isSettingUp}
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'var(--primary, #3b82f6)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                opacity: isSettingUp ? 0.7 : 1
              }}
            >
              <Key size={16} />
              보안 비밀번호 설정 완료
            </button>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', color: '#F59E0B' }}>
            <AlertTriangle size={28} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>보안 데이터 복원 필요</h2>
          </div>
          
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--foreground-muted, #94a3b8)', marginBottom: '1.5rem' }}>
            서버에 암호화된 시나리오가 저장되어 있으나, 현재 브라우저에 데이터를 복호화할 <strong>보안 백업 키</strong>가 존재하지 않거나 일치하지 않습니다.
            <br />
            이전에 백업해 두신 6자리 보안 백업 키를 입력해 주세요.
            <span style={{ color: 'var(--primary, #3b82f6)', fontSize: '0.8rem', display: 'block', marginTop: '0.5rem' }}>
              💡 카카오톡 로그인 사용자의 경우, 카카오톡 <strong>나와의 채팅방</strong>에서 <strong>NextLife</strong> 또는 <strong>보안 백업 키</strong>를 검색해 보세요!
            </span>
          </p>

          <form onSubmit={handleRestoreSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-muted)' }}>보안 백업 키 입력</label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0' }}>
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <input
                    key={idx}
                    id={`pin-input-${idx}`}
                    type="text"
                    maxLength={1}
                    value={pinInputs[idx]}
                    onChange={(e) => handlePinChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    style={{
                      width: '45px',
                      height: '45px',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      border: '1px solid var(--card-border)',
                      borderRadius: '8px',
                      color: 'var(--foreground)',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      textAlign: 'center',
                      textTransform: 'uppercase',
                      outline: 'none',
                    }}
                  />
                ))}
              </div>
              
              <button
                type="button"
                onClick={() => {
                  alert("보안 비밀번호는 안전한 종단간 암호화(E2EE) 기술로 보호되어 서버에 저장되지 않으므로 직접적인 재발송이 불가능합니다.\n\n최초 설정 및 로그인 시 회원님의 카카오톡 '나와의 채팅방'으로 자동 발송해 드렸으니, 카카오톡에서 'NextLife' 또는 '보안 백업 키'를 검색하여 확인해 주세요!");
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#FEE500',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  margin: '5px auto 15px auto',
                  textDecoration: 'underline'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z"/>
                </svg>
                카카오톡으로 보안키 전송하기
              </button>
            </div>

            <button
              type="submit"
              disabled={isRestoring}
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'var(--primary, #3b82f6)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                opacity: isRestoring ? 0.7 : 1
              }}
            >
              <Key size={16} />
              보안 키 적용 및 복원
            </button>
          </form>

        </div>
      </div>
    );
  }


  return null;
};

export default E2eeKeyManager;
