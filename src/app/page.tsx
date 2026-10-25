"use client";

import React, { useEffect } from 'react';
import { Header } from '../web/components/Header/Header';
import { SimpleSimulator } from '../web/features/Landing/SimpleSimulator';
import styles from './page.module.css';
import { useIsHydrated } from '../web/hooks/useBrowserEnvironment';

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

// 페이지 로드마다 한 번 고른다. 렌더 중에 Math.random()을 부르면 같은 입력에 다른 결과가
// 나와(purity 위반) 리렌더마다 문구가 바뀐다.
//
// 서버 번들에서도 값이 정해지지만 쓰이지 않는다 — 아래에서 하이드레이션 전에는 고정 문구를
// 쓰기 때문이다. 서버와 클라이언트의 첫 렌더가 같은 문구를 봐야 하이드레이션이 어긋나지 않는다.
const RANDOM_HERO_INDEX = Math.floor(Math.random() * HERO_PHRASES.length);
const SSR_HERO_INDEX = 6; // <>60세 이후에도 …</>

export default function LandingPage() {
  // 하이드레이션 전에는 서버가 그린 문구를 그대로 두고, 끝난 뒤에만 랜덤 문구로 바꾼다.
  // 예전에는 이 교체를 마운트 이펙트의 setState로 했는데, 그 형태는 커밋을 한 번 더 만든다.
  const hydrated = useIsHydrated();
  const heroText = HERO_PHRASES[hydrated ? RANDOM_HERO_INDEX : SSR_HERO_INDEX];

  // data-preset은 DOM 부수 효과라 이펙트가 제자리다(상태를 만들지 않는다).
  useEffect(() => {
    document.body.setAttribute('data-preset', 'base');
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
