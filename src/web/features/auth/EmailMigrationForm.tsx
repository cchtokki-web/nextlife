"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { signOut, useSession } from 'next-auth/react';
import type { EncryptedData } from '@/core/utils/crypto';
import { decryptData, isEncryptedPayload } from '@/core/utils/crypto';
import { e2eeBackedUpKeyName, e2eeKeyName } from '@/infrastructure/storage/storageKeys';
import loginStyles from './LoginForm.module.css';
import styles from './EmailMigrationForm.module.css';

type Step = 'email' | 'verify' | 'complete';

export default function EmailMigrationForm() {
  const { data: session, status } = useSession();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missingCurrentKey, setMissingCurrentKey] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    const userId = session.user.id;

    fetch('/api/user/email-migration/status')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data) => {
        setMissingCurrentKey(!localStorage.getItem(e2eeKeyName(userId)));
        if (!data.required) {
          setEmail(data.email ?? '');
          setStep('complete');
        }
      })
      .catch(() => setError('전환 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.'))
      .finally(() => setChecking(false));
  }, [session?.user?.id, status]);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/user/email-migration/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? '인증번호를 보내지 못했습니다.');
        return;
      }
      setEmail(email.trim().toLowerCase());
      setNotice(data.message ?? '입력한 이메일로 인증번호를 보냈습니다.');
      setStep('verify');
    } catch {
      setError('인증번호 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCurrentSecurityKey = async (securityKey: string): Promise<boolean> => {
    const userId = session?.user?.id;
    if (!userId) return false;
    const response = await fetch('/api/scenarios');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const encryptedRows: Array<{ data: EncryptedData }> = (Array.isArray(payload.data) ? payload.data : [])
      .filter((row: { data: unknown }) => isEncryptedPayload(row.data));
    if (encryptedRows.length === 0) return true;

    for (const row of encryptedRows) {
      try {
        await decryptData(row.data, securityKey, userId);
        return true;
      } catch {
        // 다른 행이 정상일 수 있으므로 모두 확인한다.
      }
    }
    return false;
  };

  const completeMigration = async (event: React.FormEvent) => {
    event.preventDefault();
    const userId = session?.user?.id;
    const securityKey = userId ? localStorage.getItem(e2eeKeyName(userId))?.trim().toUpperCase() : null;
    if (!/^\d{6}$/.test(code)) {
      setError('이메일 인증번호 6자리를 입력해 주세요.');
      return;
    }
    if (!securityKey || securityKey.length !== 6) {
      setMissingCurrentKey(true);
      setError('이 브라우저에 현재 보안키가 없어 기존 데이터를 확인할 수 없습니다. 데이터를 초기화하고 새 키를 발급받아 주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (!await verifyCurrentSecurityKey(securityKey)) {
        setMissingCurrentKey(true);
        setError('이 브라우저에 저장된 키로 기존 데이터를 열 수 없습니다. 데이터를 초기화하고 새 키를 발급받아 주세요.');
        return;
      }

      const response = await fetch('/api/user/email-migration/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, securityKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? '이메일 로그인 전환을 완료하지 못했습니다.');
        return;
      }

      if (userId) {
        localStorage.setItem(e2eeKeyName(userId), securityKey);
        localStorage.setItem(e2eeBackedUpKeyName(userId), data.keyEmailSent ? 'true' : 'false');
      }
      setNotice(data.keyEmailSent
        ? '이메일 로그인 전환이 완료됐고 보안키도 이메일로 다시 보내드렸습니다.'
        : '이메일 로그인 전환은 완료됐지만 보안키 메일 발송에 실패했습니다. 현재 보안키를 안전하게 보관해 주세요.');
      setStep('complete');
    } catch {
      setError('기존 데이터 또는 서버 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const resetDataAndCompleteMigration = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/user/email-migration/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? '데이터 초기화와 보안키 재발급을 완료하지 못했습니다.');
        return;
      }
      const userId = session?.user?.id;
      if (userId) {
        localStorage.removeItem(e2eeKeyName(userId));
        localStorage.removeItem(e2eeBackedUpKeyName(userId));
      }
      setNotice('기존 데이터를 초기화하고 새 보안키를 이메일로 보냈습니다. 이메일의 새 키로 로그인해 주세요.');
      setConfirmingReset(false);
      setStep('complete');
    } catch {
      setError('초기화 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (checking || status === 'loading') {
    return <div className={`glass ${loginStyles.loginContainer}`}><p className={loginStyles.subtitle}>전환 상태 확인 중...</p></div>;
  }

  if (status !== 'authenticated' || session?.user?.provider !== 'kakao') {
    return (
      <div className={`glass ${loginStyles.loginContainer}`}>
        <h2 className={loginStyles.title}>카카오 계정 전환</h2>
        <p className={loginStyles.subtitle}>기존 카카오 계정으로 로그인한 뒤 이용해 주세요.</p>
        <button className={loginStyles.submitBtn} onClick={() => window.location.href = '/login'}>로그인으로 이동</button>
      </div>
    );
  }

  return (
    <div className={`glass animate-fade-in ${loginStyles.loginContainer}`}>
      <div className={loginStyles.logoWrapper}>
        <Image src="/logo.png" alt="NextLife Logo" width={140} height={140} priority />
      </div>
      <h2 className={loginStyles.title}>이메일 로그인으로 전환</h2>

      {step === 'email' && (
        <form onSubmit={requestCode}>
          <p className={loginStyles.subtitle}>기존 시나리오와 자산 데이터는 그대로 유지됩니다.</p>
          <div className={styles.infoBox}>
            이메일 인증 후 현재 계정에 이메일 로그인을 연결합니다. 같은 이메일로 만든 계정이 있으면 저장된 시나리오를 빠짐없이 함께 병합합니다.
          </div>
          <div className={loginStyles.formGroup}>
            <label htmlFor="migration-email" className={loginStyles.label}>연결할 이메일 주소</label>
            <input id="migration-email" type="email" required autoComplete="email" className={loginStyles.input} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="example@example.com" />
          </div>
          {error && <div role="alert" className={loginStyles.errorMessage}>{error}</div>}
          <button disabled={loading} className={loginStyles.submitBtn}>{loading ? '발송 중...' : '인증번호 받기'}</button>
        </form>
      )}

      {step === 'verify' && (
        <form onSubmit={completeMigration}>
          <p className={loginStyles.subtitle}><strong>{email}</strong>로 받은 인증번호를 입력해 주세요.</p>
          {notice && <div className={loginStyles.successMessage}>{notice}</div>}
          <div className={loginStyles.formGroup}>
            <label htmlFor="migration-code" className={loginStyles.label}>이메일 인증번호</label>
            <input id="migration-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className={loginStyles.input} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 숫자" />
          </div>
          <div className={styles.infoBox}>이 브라우저에 저장된 현재 보안키로 기존 데이터를 확인합니다. 전환이 완료되면 같은 보안키를 입력한 이메일로 다시 보내드립니다.</div>
          {error && <div role="alert" className={loginStyles.errorMessage}>{error}</div>}
          <button disabled={loading} className={loginStyles.submitBtn}>{loading ? '확인 중...' : '이메일 로그인 연결'}</button>
          {missingCurrentKey && (
            confirmingReset ? (
              <div className={loginStyles.resetWarning}>
                <strong>기존 데이터를 모두 초기화하시겠습니까?</strong>
                <p>현재 카카오 계정과 같은 이메일로 만든 계정의 시나리오·자산 데이터가 모두 삭제되고 새 보안키가 이메일로 발송됩니다. 이 작업은 되돌릴 수 없습니다.</p>
                <div className={loginStyles.resetActions}>
                  <button type="button" className={loginStyles.secondaryBtn} onClick={() => setConfirmingReset(false)}>취소</button>
                  <button type="button" className={loginStyles.dangerBtn} disabled={loading} onClick={resetDataAndCompleteMigration}>삭제하고 새 키 받기</button>
                </div>
              </div>
            ) : (
              <button type="button" className={loginStyles.dangerBtn} onClick={() => setConfirmingReset(true)}>데이터 초기화 및 새 보안키 발급</button>
            )
          )}
          <button type="button" className={loginStyles.textBtn} onClick={() => { setStep('email'); setError(null); }}>이메일 다시 입력</button>
        </form>
      )}

      {step === 'complete' && (
        <div>
          <div className={loginStyles.successMessage}>{notice ?? `${email || '이메일 계정'}으로의 전환이 완료되었습니다.`}</div>
          <p className={loginStyles.subtitle}>카카오 세션을 종료한 뒤 이메일로 받은 보안키로 다시 로그인해 주세요.</p>
          <button className={loginStyles.submitBtn} onClick={() => signOut({ callbackUrl: '/login?migrated=1' })}>카카오 로그아웃 후 이메일 로그인</button>
        </div>
      )}
    </div>
  );
}
