"use client";

import React from 'react';

import Image from 'next/image';
import styles from './Header.module.css';

export function Header({ children }: { children?: React.ReactNode }) {

  return (
    <header className={styles.header}>
      <div className={styles.logoArea}>
        <Image src="/logo-icon.png" alt="NextLife Icon" width={48} height={48} style={{ borderRadius: '10px', transform: 'translateY(-2px)' }} />
        <h1 className={styles.logoText}>NextLife</h1>
      </div>
      {children && (
        <div className={styles.actions}>
          {children}
        </div>
      )}
    </header>
  );
}
