"use client";

import React from 'react';
import Image from 'next/image';
import styles from './Header.module.css';
import { Check, Loader2, AlertCircle, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/web/components/providers/ThemeProvider';

interface HeaderProps {
  children?: React.ReactNode;
  saveStatus?: 'idle' | 'saving' | 'success' | 'error';
  isSaving?: boolean;
  lastSaved?: Date | null;
}

export function Header({ children, saveStatus = 'idle', isSaving = false, lastSaved }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <header className={styles.header}>
      <div className={styles.logoArea}>
        <Image src="/logo-icon.png" alt="NextLife Icon" width={48} height={48} style={{ borderRadius: '10px', transform: 'translateY(-2px)' }} />
        <h1 className={styles.logoText}>NextLife</h1>

        {/* Save Status Indicator */}
        {saveStatus !== 'idle' && (
          <div className={`${styles.saveStatusBadge} ${styles[saveStatus]}`} title={lastSaved ? `마지막 저장 시간: ${lastSaved.toLocaleString()}` : ''}>
            {isSaving ? (
              <>
                <Loader2 size={12} className={styles.spin} />
                <span>저장 중...</span>
              </>
            ) : saveStatus === 'success' ? (
              <>
                <Check size={12} />
                <span>저장 완료{lastSaved ? ` (${formatTime(lastSaved)})` : ''}</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <AlertCircle size={12} />
                <span>저장 실패</span>
              </>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <button 
          type="button"
          onClick={toggleTheme} 
          className={styles.themeToggle}
          title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        {children}
      </div>
    </header>
  );
}
