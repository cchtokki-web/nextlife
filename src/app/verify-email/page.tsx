"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "@/web/features/auth/LoginForm.module.css";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("토큰이 유효하지 않습니다.");
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${token}`);
        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setMessage(data.message || "이메일 인증이 완료되었습니다.");
        } else {
          setStatus("error");
          setMessage(data.error || "이메일 인증에 실패했습니다.");
        }
      } catch {
        setStatus("error");
        setMessage("인증 처리 중 오류가 발생했습니다.");
      }
    };

    verify();
  }, [token]);

  return (
    <div className={`glass animate-fade-in ${styles.loginContainer}`} style={{ textAlign: 'center' }}>
      <div className={styles.logoWrapper}>
        <Image 
          src="/logo.png" 
          alt="NextLife Logo" 
          width={120} 
          height={120} 
          priority
          className="drop-shadow-md"
        />
      </div>
      
      <h2 className={styles.title}>이메일 인증</h2>
      
      {status === "loading" && (
        <>
          <p className={styles.subtitle}>인증 처리 중입니다. 잠시만 기다려주세요...</p>
          <div style={{ padding: '2rem 0', color: 'var(--primary)' }}>
            로딩 중...
          </div>
        </>
      )}
      
      {status === "success" && (
        <>
          <p className={styles.subtitle}>이메일 인증이 성공적으로 완료되었습니다.</p>
          <div className={styles.successMessage} style={{ marginBottom: '2rem' }}>
            {message}
          </div>
          <Link href="/login" style={{ textDecoration: 'none' }}>
            <button className={styles.submitBtn}>
              로그인하러 가기
            </button>
          </Link>
        </>
      )}
      
      {status === "error" && (
        <>
          <p className={styles.subtitle}>이메일 인증에 실패했습니다.</p>
          <div className={styles.errorMessage} style={{ marginBottom: '2rem' }}>
            {message}
          </div>
          <Link href="/register" style={{ textDecoration: 'none' }}>
            <button className={styles.submitBtn}>
              다시 회원가입하기
            </button>
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <Suspense fallback={<div style={{ color: 'var(--foreground)' }}>로딩 중...</div>}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
