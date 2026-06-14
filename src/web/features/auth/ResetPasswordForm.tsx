"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import styles from "./LoginForm.module.css";

export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!token) {
      setStatus("error");
      setMessage("유효하지 않은 접근입니다. 이메일 링크를 다시 확인해주세요.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("비밀번호가 일치하지 않습니다.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "비밀번호 변경에 실패했습니다.");
      } else {
        setStatus("success");
        setMessage("비밀번호가 성공적으로 변경되었습니다. 새 비밀번호로 로그인해주세요.");
        setTimeout(() => {
          router.push("/login");
        }, 3000);
      }
    } catch (err) {
      setStatus("error");
      setMessage("요청 처리 중 오류가 발생했습니다.");
    }
  };

  if (!token) {
    return (
      <div className={`glass animate-fade-in ${styles.loginContainer}`}>
        <div className={styles.logoWrapper}>
          <Image src="/logo.png" alt="Logo" width={160} height={160} className="drop-shadow-md" />
        </div>
        <h2 className={styles.title}>비밀번호 재설정</h2>
        <div className={styles.errorMessage}>
          유효하지 않은 접근입니다. 올바른 링크로 접속해주세요.
        </div>
        <div className={styles.footer} style={{ marginTop: '24px' }}>
          <Link href="/login" className={styles.link}>로그인으로 이동</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`glass animate-fade-in ${styles.loginContainer}`}>
      <div className={styles.logoWrapper}>
        <Image 
          src="/logo.png" 
          alt="NextLife Logo" 
          width={160} 
          height={160} 
          priority
          className="drop-shadow-md"
        />
      </div>
      
      <h2 className={styles.title}>새 비밀번호 설정</h2>
      <p className={styles.subtitle}>새롭게 사용할 비밀번호를 입력해주세요.</p>
      
      <div style={{ minHeight: message ? 'auto' : '0' }}>
        {status === "error" && (
          <div className={styles.errorMessage}>
            {message}
          </div>
        )}
        {status === "success" && (
          <div className={styles.successMessage} style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '12px', borderRadius: '8px', marginBottom: '16px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            {message}
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="mt-2" style={{ display: status === "success" ? "none" : "block" }}>
        <div className={styles.formGroup}>
          <label className={styles.label}>새 비밀번호</label>
          <input
            type="password"
            required
            className={styles.input}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label className={styles.label}>새 비밀번호 확인</label>
          <input
            type="password"
            required
            className={styles.input}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        
        <button
          type="submit"
          disabled={status === "loading"}
          className={styles.submitBtn}
        >
          {status === "loading" ? "변경 중..." : "비밀번호 변경하기"}
        </button>
      </form>
    </div>
  );
}
