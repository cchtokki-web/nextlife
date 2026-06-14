"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "./LoginForm.module.css";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (res?.error) {
        setError(res.error);
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError("로그인 중 오류가 발생했습니다.");
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
      
      <h2 className={styles.title}>로그인</h2>
      <p className={styles.subtitle}>은퇴 자산 시뮬레이터에 오신 것을 환영합니다.</p>
      
      <div style={{ minHeight: error ? 'auto' : '0' }}>
        {error && (
          <div className={styles.errorMessage}>
            {error}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className={styles.label}>비밀번호</label>
            <Link href="/forgot-password" className={styles.link} style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              비밀번호 찾기
            </Link>
          </div>
          <input
            type="password"
            required
            className={styles.input}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className={styles.submitBtn}
        >
          {loading ? "인증하는 중..." : "로그인"}
        </button>
      </form>
      
      <div className={styles.footer}>
        계정이 없으신가요?{" "}
        <Link href="/register" className={styles.link}>
          회원가입
        </Link>
      </div>
    </div>
  );
}
