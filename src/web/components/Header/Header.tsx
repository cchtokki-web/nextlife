"use client";

import React from 'react';
import Image from 'next/image';
import styles from './Header.module.css';
import { Loader2, AlertCircle } from 'lucide-react';

interface HeaderProps {
  children?: React.ReactNode;
  utilityActions?: React.ReactNode;
  saveStatus?: 'idle' | 'saving' | 'success' | 'error';
  isSaving?: boolean;
  lastSaved?: Date | null;
}

export function Header({ children, utilityActions, saveStatus = 'idle', isSaving = false, lastSaved }: HeaderProps) {

  return (
    <header className={styles.header}>
      <div className={styles.logoArea}>
        <Image src="/logo-icon.png" alt="NextLife Icon" width={48} height={48} style={{ borderRadius: '10px', transform: 'translateY(-2px)' }} />
        <h1 className={styles.logoText}>NextLife</h1>

        {/* Save Status Indicator */}
        {(isSaving || saveStatus === 'saving' || saveStatus === 'error') && (
          <div
            className={`${styles.saveStatusBadge} ${styles[isSaving || saveStatus === 'saving' ? 'saving' : 'error']}`}
            title={lastSaved ? `마지막 저장 시간: ${lastSaved.toLocaleString()}` : ''}
          >
            {isSaving || saveStatus === 'saving' ? (
              <>
                <Loader2 size={12} className={styles.spin} />
                <span>저장 중...</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <AlertCircle size={12} />
                <span>저장 실패</span>
              </>
            ) : null}
          </div>
        )}
        <div className={styles.statusActions}>
          {utilityActions}
        </div>
      </div>
      <div className={styles.actions}>
        {children}
      </div>
    </header>
  );
}
