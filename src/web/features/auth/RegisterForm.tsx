"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "./LoginForm.module.css";

export default function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "회원가입에 실패했습니다.");
      } else {
        setSuccessMessage(data.message);
        setEmail("");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      setError("요청 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

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
      
      <h2 className={styles.title}>회원가입</h2>
      <p className={styles.subtitle}>새로운 계정을 만들어 시뮬레이션을 시작하세요.</p>
      
      <div style={{ minHeight: (error || successMessage) ? 'auto' : '0' }}>
        {error && (
          <div className={styles.errorMessage}>
            {error}
          </div>
        )}
        
        {successMessage && (
          <div className={styles.successMessage}>
            {successMessage}
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="mt-2">
        <div className={styles.formGroup}>
          <label className={styles.label}>이메일</label>
          <input
            type="email"
            required
            className={styles.input}
            placeholder="example@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label className={styles.label}>비밀번호</label>
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
          <label className={styles.label}>비밀번호 확인</label>
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
          disabled={loading || !!successMessage}
          className={styles.submitBtn}
        >
          {loading ? "처리 중..." : "회원가입"}
        </button>
      </form>
      
      <div className={styles.footer}>
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className={styles.link}>
          로그인
        </Link>
      </div>
    </div>
  );
}
