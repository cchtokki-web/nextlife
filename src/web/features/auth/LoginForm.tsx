"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "./LoginForm.module.css";

export default function LoginForm() {
  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

  useEffect(() => {
    if (isDevMode) {
      signIn('credentials', { email: 'dev', password: 'dev', callbackUrl: '/' });
    }
  }, [isDevMode]);

  if (isDevMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#fff', textAlign: 'center' }}>
        <div className="animate-pulse" style={{ fontSize: '1.2rem', fontWeight: 600 }}>개발 모드 자동 로그인 중...</div>
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
      
      <h2 className={styles.title}>로그인</h2>
      <p className={styles.subtitle}>은퇴 자산 시뮬레이터에 오신 것을 환영합니다.</p>
      
      <div className="mt-2" style={{ marginTop: '2rem' }}>
        <button 
          type="button"
          onClick={() => {
            if (process.env.NEXT_PUBLIC_DEV_MODE === 'true') {
              signIn('credentials', { email: 'dev', password: 'dev', callbackUrl: '/' });
            } else {
              signIn('kakao', { callbackUrl: '/' });
            }
          }}
          style={{ 
            backgroundColor: '#FEE500', 
            color: '#191919', 
            padding: '1rem 1.2rem', 
            borderRadius: '12px', 
            fontWeight: 700, 
            fontSize: '1.05rem', 
            border: 'none', 
            cursor: 'pointer', 
            boxShadow: '0 4px 10px rgba(0,0,0,0.1)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            gap: '0.6rem',
            width: '100%',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 14px rgba(0,0,0,0.2)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z" fill="currentColor"/>
          </svg>
          카카오로 3초 만에 시작하기
        </button>
      </div>
    </div>
  );
}
