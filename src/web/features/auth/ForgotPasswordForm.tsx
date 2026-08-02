"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./LoginForm.module.css"; // Reuse login form styles for consistency

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "요청에 실패했습니다.");
      } else {
        setStatus("success");
        setMessage("비밀번호 재설정 이메일이 발송되었습니다. 메일함을 확인해주세요.");
      }
    } catch {
      setStatus("error");
      setMessage("요청 처리 중 오류가 발생했습니다.");
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
      
      <h2 className={styles.title}>비밀번호 찾기</h2>
      <p className={styles.subtitle}>가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.</p>
      
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
        
        <button
          type="submit"
          disabled={status === "loading"}
          className={styles.submitBtn}
        >
          {status === "loading" ? "전송 중..." : "재설정 링크 받기"}
        </button>
      </form>
      
      <div className={styles.footer} style={{ marginTop: '24px' }}>
        기억나셨나요?{" "}
        <Link href="/login" className={styles.link}>
          로그인으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
