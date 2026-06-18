"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signOut, useSession } from 'next-auth/react';
import { Settings, LogOut } from 'lucide-react';
import styles from './Header.module.css';

export function Header({ children }: { children?: React.ReactNode }) {
  const { status } = useSession();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logoArea}>
        <Image src="/logo-icon.png" alt="NextLife Icon" width={48} height={48} style={{ borderRadius: '10px', transform: 'translateY(-2px)' }} />
        <h1 className={styles.logoText}>NextLife</h1>
      </Link>
      
      {status === 'authenticated' && (
        <div className={styles.actions}>
          {children}
          {children && <div style={{ width: '1px', height: '24px', background: 'var(--card-border)', margin: '0 0.25rem' }} />}
          <Link href="/settings" className={styles.actionButton}>
            <Settings size={16} />
            <span>설정</span>
          </Link>
          <button 
            onClick={() => signOut({ callbackUrl: '/login' })}
            className={styles.actionButton}
          >
            <LogOut size={16} />
            <span>로그아웃</span>
          </button>
        </div>
      )}
    </header>
  );
}
