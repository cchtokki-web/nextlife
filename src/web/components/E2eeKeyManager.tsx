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
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSendingKakao, setIsSendingKakao] = useState(false);
  const [kakaoSentStatus, setKakaoSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

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
    setIsRestoring(true);
    const success = await handleRestoreKey(restoreKeyInput);
    setIsRestoring(false);
    if (success) {
      alert('보안 백업 키가 성공적으로 복원되었습니다.');
      setRestoreKeyInput('');
    } else {
      alert('보안 백업 키 복원에 실패했습니다. 키 형식을 다시 확인해 주세요.');
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
              <input
                type="text"
                placeholder="6자리 보안 키 입력 (예: AB2CD3)"
                value={restoreKeyInput}
                onChange={(e) => setRestoreKeyInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
              />
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

          {onResetScenarios && (
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: '0.5rem' }}>
                만약 키를 분실하셨다면, 기존 암호화된 서버 데이터를 복구할 수 없습니다.
              </p>
              <button
                onClick={onResetScenarios}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--danger, #ef4444)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                기존 서버 데이터를 포기하고 초기화하기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. Backup key banner (Alerts user if they haven't copied/saved their generated key)
  if (localKey && !isBackupKeyBackedUp) {
    return (
      <div style={{
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        color: 'var(--foreground)'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ color: 'var(--primary, #3b82f6)', marginTop: '0.15rem' }}>
            <Key size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.25rem 0' }}>데이터 종단간 암호화(E2EE)가 활성화되었습니다</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', margin: 0, lineHeight: 1.5 }}>
              입력하신 모든 정보는 관리자도 열람할 수 없도록 브라우저에서 안전하게 암호화되어 저장됩니다. 
              다른 기기에서 접속하거나 브라우저 쿠키를 삭제할 때 데이터를 복원하려면 아래 <strong>보안 백업 키</strong>를 안전한 곳에 보관해 주세요.
            </p>
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem', 
          backgroundColor: 'rgba(0, 0, 0, 0.2)', 
          padding: '0.5rem 0.75rem', 
          borderRadius: '8px',
          border: '1px solid var(--card-border)'
        }}>
          <span style={{ 
            fontFamily: 'monospace', 
            fontSize: '0.75rem', 
            wordBreak: 'break-all', 
            flex: 1, 
            color: 'var(--foreground-muted)' 
          }}>
            {formatBackupKey(localKey)}
          </span>
          <button
            onClick={handleCopyKey}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.35rem 0.75rem',
              backgroundColor: copied ? '#10B981' : 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s'
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '복사됨' : '백업 키 복사'}
          </button>

          {handleSendKeyToKakao && (
            <button
              onClick={handleSendKakao}
              disabled={isSendingKakao}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.75rem',
                backgroundColor: kakaoSentStatus === 'success' ? '#10B981' : kakaoSentStatus === 'error' ? '#EF4444' : '#FEE500',
                border: 'none',
                borderRadius: '6px',
                color: kakaoSentStatus === 'success' || kakaoSentStatus === 'error' ? '#fff' : '#191919',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                opacity: isSendingKakao ? 0.7 : 1
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z"/>
              </svg>
              {isSendingKakao ? '전송 중...' : kakaoSentStatus === 'success' ? '카카오톡 전송됨' : kakaoSentStatus === 'error' ? '전송 실패' : '카카오톡으로 전송'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default E2eeKeyManager;
