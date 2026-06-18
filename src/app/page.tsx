"use client";

import React, { useEffect, useState } from 'react';
import { Header } from '../web/components/Header/Header';
import { SimpleSimulator } from '../web/features/Landing/SimpleSimulator';
import styles from './page.module.css';

const HERO_PHRASES = [
  <>은퇴 후에도<br />생활비 걱정 없이<br />살 수 있을까요?</>,
  <>은퇴 후에도<br />돈 걱정 없이<br />살 수 있을까요?</>,
  <>은퇴 후에도<br />먹고 싶은 것 먹고<br />여행 다닐 수 있을까요?</>,
  <>노후 자금<br />정말 충분할까요?<br />1분 만에 확인해보세요</>,
  <>자녀에게 부담 주지 않고<br />편안한 노후를<br />보낼 수 있을까요?</>,
  <>은퇴 후<br />통장 잔고를 걱정하며<br />살게 될까요?</>,
  <>60세 이후에도<br />지금의 생활 수준을<br />유지할 수 있을까요?</>,
  <>언제까지 일해야<br />노후 걱정 없이<br />살 수 있을까요?</>,
  <>내가 모은 돈으로<br />몇 살까지<br />살 수 있을까요?</>,
  <>은퇴 후에도<br />돈 때문에 하고 싶은 것을<br />포기하지 않을 수 있을까요?</>
];

export default function LandingPage() {
  const [heroText, setHeroText] = useState<React.ReactNode>(
    <>60세 이후에도<br />지금의 생활 수준을<br />유지할 수 있을까요?</>
  );

  // 기본 테마(색상, 글로우 등) 설정
  useEffect(() => {
    // 하이드레이션 이후 랜덤 문구로 교체 (hydration mismatch 방지)
    setHeroText(HERO_PHRASES[Math.floor(Math.random() * HERO_PHRASES.length)]);

    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-preset', 'base');
    }
  }, []);

  return (
    <main className={styles.main}>
      <Header />
      
      <div className={styles.backgroundGlow} />

      <section className={styles.hero}>
        <h1 className={styles.heroTitle} style={{ marginBottom: '1.5rem' }}>
          {heroText}
        </h1>
        <div className={styles.heroBadge}>
          ✨ 회원가입 없이 무료로 1분 만에 확인하세요
        </div>

        <div className={styles.simulatorContainer}>
          <SimpleSimulator />
        </div>
      </section>

      <footer className={styles.footer}>
        <p>
          본 서비스의 결과는 단순 시뮬레이션이며, 실제 자산 가치 및 수익률을 보장하지 않습니다.<br />
          정확한 재무 설계는 전문가와 상담하시기 바랍니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          &copy; {new Date().getFullYear()} NextLife. Created by TokkiLab.<br />
          Contact: <a href="mailto:cchtokki@gmail.com" style={{ textDecoration: 'underline' }}>cchtokki@gmail.com</a>
        </p>
      </footer>
    </main>
  );
}
