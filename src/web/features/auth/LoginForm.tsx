"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import Image from "next/image";
import { e2eeBackedUpKeyName, e2eeKeyName } from "@/infrastructure/storage/storageKeys";
import { resolveDevCallbackUrl } from "./resolveDevCallbackUrl";
import styles from "./LoginForm.module.css";

type Flow = 'choose' | 'register-email' | 'login-email' | 'security-key';

export default function LoginForm({
  initialFlow = 'choose',
}: {
  initialFlow?: 'choose' | 'register-email';
}) {
  const [flow, setFlow] = useState<Flow>(initialFlow);
  const [email, setEmail] = useState('');
  const [keyDigits, setKeyDigits] = useState(['', '', '', '', '', '']);
  const [isRegistering, setIsRegistering] = useState(initialFlow === 'register-email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingAccountReset, setConfirmingAccountReset] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [isRuntimeDevMode, setIsRuntimeDevMode] = useState<boolean | null>(() =>
    process.env.NEXT_PUBLIC_DEV_MODE === 'true' ? true : null,
  );
  const keyRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEV_MODE === 'true') return;
    fetch('/api/dev-mode')
      .then((res) => res.json())
      .then((data) => setIsRuntimeDevMode(Boolean(data?.isDevMode)))
      .catch(() => setIsRuntimeDevMode(false));
  }, []);

  useEffect(() => {
    if (isRuntimeDevMode !== true) return;
    const target = resolveDevCallbackUrl(window.location.search);
    signIn('credentials', { email: 'dev', securityKey: 'dev', redirect: false })
      .then((res) => {
        if (res?.ok) window.location.href = target;
        else setError(res?.error ?? '자동 로그인에 실패했습니다.');
      })
      .catch(() => setError('자동 로그인 중 오류가 발생했습니다.'));
  }, [isRuntimeDevMode]);

  const selectFlow = (next: 'register-email' | 'login-email') => {
    setIsRegistering(next === 'register-email');
    setFlow(next);
    setError(null);
    setMessage(null);
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    if (!isRegistering) {
      setEmail(normalizedEmail);
      setFlow('security-key');
      setTimeout(() => keyRefs.current[0]?.focus(), 50);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, confirmReset: confirmingAccountReset }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === 'ACCOUNT_RESET_REQUIRED') {
          setConfirmingAccountReset(true);
        }
        setError(data.error ?? '회원가입을 시작하지 못했습니다.');
        return;
      }
      setEmail(normalizedEmail);
      setMessage(data.message ?? '이메일로 보안키를 보냈습니다.');
      setConfirmingAccountReset(false);
      setFlow('security-key');
      setTimeout(() => keyRefs.current[0]?.focus(), 50);
    } catch {
      setError('요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const updateKey = (index: number, rawValue: string) => {
    const value = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const next = [...keyDigits];
    if (value.length >= 6) {
      value.slice(0, 6).split('').forEach((character, digitIndex) => { next[digitIndex] = character; });
      setKeyDigits(next);
      keyRefs.current[5]?.focus();
      return;
    }
    next[index] = value.slice(-1);
    setKeyDigits(next);
    if (value && index < 5) keyRefs.current[index + 1]?.focus();
  };

  const submitSecurityKey = async (event: React.FormEvent) => {
    event.preventDefault();
    const securityKey = keyDigits.join('').toUpperCase();
    if (securityKey.length !== 6) {
      setError('이메일로 받은 6자리 보안키를 모두 입력해 주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        email,
        securityKey,
        redirect: false,
        callbackUrl: '/simulator',
      });
      if (!result?.ok) {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        setKeyDigits(['', '', '', '', '', '']);
        setError(`보안키가 올바르지 않습니다. (${attempts}/5)`);
        setTimeout(() => keyRefs.current[0]?.focus(), 50);
        return;
      }

      const session = await getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Session was not created');
      localStorage.setItem(e2eeKeyName(userId), securityKey);
      localStorage.setItem(e2eeBackedUpKeyName(userId), 'true');
      window.location.href = result.url || '/simulator';
    } catch {
      setError('로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const requestSecurityKeyReset = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/security-key/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? '보안키를 재발급하지 못했습니다.');
        return;
      }
      setMessage('새 보안키를 이메일로 보냈습니다. 새 키를 입력하면 기존 데이터가 초기화되고 로그인됩니다.');
      setKeyDigits(['', '', '', '', '', '']);
      setFailedAttempts(0);
      setConfirmingReset(false);
      setTimeout(() => keyRefs.current[0]?.focus(), 50);
    } catch {
      setError('보안키 재발급 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (isRuntimeDevMode === null || isRuntimeDevMode === true) {
    return (
      <div className={`glass animate-fade-in ${styles.loginContainer}`}>
        <div className={styles.title}>{error ? '개발 모드 자동 로그인 실패' : '개발 모드 자동 로그인 중...'}</div>
        {error && <div role="alert" className={styles.errorMessage}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={`glass animate-fade-in ${styles.loginContainer}`}>
      <div className={styles.logoWrapper}>
        <Image src="/logo.png" alt="NextLife Logo" width={160} height={160} priority className="drop-shadow-md" />
      </div>
      <h2 className={styles.title}>{flow === 'security-key' ? '보안키 입력' : 'NextLife 시작하기'}</h2>

      {flow === 'choose' && (
        <>
          <p className={styles.subtitle}>이메일로 간편하게 가입하고 자산 데이터를 안전하게 보관하세요.</p>
          {message && <div className={styles.successMessage}>{message}</div>}
          <button type="button" className={styles.submitBtn} onClick={() => selectFlow('register-email')}>
            이메일로 회원가입
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={() => selectFlow('login-email')}>
            이미 가입했다면 이메일로 로그인
          </button>
        </>
      )}

      {(flow === 'register-email' || flow === 'login-email') && (
        <form onSubmit={submitEmail}>
          <p className={styles.subtitle}>
            {isRegistering
              ? '입력한 이메일 주소로 6자리 보안키를 보내드립니다.'
              : '가입한 이메일 주소와 이메일로 받은 보안키로 로그인합니다.'}
          </p>
          {isRegistering && (
            <div className={styles.securityNotice}>
              보안키는 로그인과 고객 데이터 암호화에 사용됩니다. 분실하면 저장된 데이터를 복구할 수 없으므로 이메일을 삭제하지 말고 안전하게 보관해 주세요.
            </div>
          )}
          <div className={styles.formGroup}>
            <label htmlFor="email" className={styles.label}>이메일 주소</label>
            <input id="email" type="email" required autoComplete="email" className={styles.input} placeholder="example@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          {error && <div role="alert" className={styles.errorMessage}>{error}</div>}
          {confirmingAccountReset && (
            <div className={styles.resetWarning}>
              <strong>기존 계정을 초기화하시겠습니까?</strong>
              <p>새 보안키로 로그인하면 기존 시나리오와 자산 데이터가 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
            </div>
          )}
          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading
              ? '보안키 발송 중...'
              : isRegistering
                ? confirmingAccountReset ? '초기화하고 새 보안키 받기' : '가입하고 보안키 받기'
                : '보안키 입력하기'}
          </button>
          <button type="button" className={styles.textBtn} onClick={() => { setFlow('choose'); setConfirmingAccountReset(false); setError(null); }}>취소</button>
        </form>
      )}

      {flow === 'security-key' && (
        <form onSubmit={submitSecurityKey}>
          <p className={styles.subtitle}><strong>{email}</strong>로 전송된 보안키를 입력해 주세요.</p>
          {message && <div className={styles.successMessage}>{message}</div>}
          <div className={styles.pinGroup}>
            {keyDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => { keyRefs.current[index] = element; }}
                aria-label={`보안키 ${index + 1}번째 자리`}
                type="password"
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={6}
                value={digit}
                disabled={loading}
                onChange={(event) => updateKey(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !digit && index > 0) keyRefs.current[index - 1]?.focus();
                }}
                className={styles.pinInput}
              />
            ))}
          </div>
          {error && <div role="alert" className={styles.errorMessage}>{error}</div>}
          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? '확인 중...' : isRegistering ? '가입 및 로그인' : '로그인'}
          </button>
          {failedAttempts >= 5 && !isRegistering && (
            confirmingReset ? (
              <div className={styles.resetWarning}>
                <strong>정말 초기화하시겠습니까?</strong>
                <p>새 보안키를 이메일로 보내드립니다. 그 키를 입력하면 기존 자산 데이터가 모두 삭제되며 되돌릴 수 없습니다.</p>
                <div className={styles.resetActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmingReset(false)}>취소</button>
                  <button type="button" className={styles.dangerBtn} disabled={loading} onClick={requestSecurityKeyReset}>수락하고 재전송</button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.dangerBtn} onClick={() => setConfirmingReset(true)}>
                데이터 초기화 및 보안키 재전송
              </button>
            )
          )}
          <button type="button" className={styles.textBtn} onClick={() => { setFlow(isRegistering ? 'register-email' : 'login-email'); setError(null); setConfirmingReset(false); }}>이메일 주소 다시 입력</button>
        </form>
      )}
    </div>
  );
}
