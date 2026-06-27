"use client";

import React from 'react';

import Image from 'next/image';
import styles from './Header.module.css';
import { Lock } from 'lucide-react';

export function Header({ children }: { children?: React.ReactNode }) {

  return (
    <header className={styles.header}>
      <div className={styles.logoArea}>
        <Image src="/logo-icon.png" alt="NextLife Icon" width={48} height={48} style={{ borderRadius: '10px', transform: 'translateY(-2px)' }} />
        <h1 className={styles.logoText}>NextLife</h1>
        <div className={styles.securityBadge} title="사용자 데이터가 로컬에서 암호화되어 서버로 저장되므로 관리자도 열람이 불가능합니다.">
          <Lock size={12} />
          <span>E2EE 암호화 (관리자 열람 불가)</span>
        </div>
      </div>
      {children && (
        <div className={styles.actions}>
          {children}
        </div>
      )}
    </header>
  );
}
