import React from 'react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import styles from './Dashboard.module.css';

interface HeroSummaryCardProps {
  score: number; // 0 ~ 100
  expectancyAge: number;
  depletionAge: number | null;
  alternatives?: { label: string; score: number }[];
}

export const HeroSummaryCard: React.FC<HeroSummaryCardProps> = ({ score, expectancyAge, depletionAge, alternatives = [] }) => {
  const { data: session } = useSession();
  const userNamePrefix = session?.user?.name ? `${session.user.name}님의 ` : '';

  let colorClass = styles.colorGreen;
  let messageTitle = `${userNamePrefix}현재 계획으로는`;
  let messageSub = '노후 자산이 안정적으로 유지될 가능성이 높습니다.';

  if (score < 70) {
    colorClass = styles.colorRed;
    messageTitle = `⚠️ ${userNamePrefix}현재 계획으로는`;
    if (depletionAge === null) {
      messageSub = '자산 고갈 위험은 없으나 배당이나 연금 등 패시브 인컴 비중이 너무 낮아 불안정한 구조입니다';
    } else {
      messageSub = '노후 자산 고갈 위험과 생활비 부족 가능성이 있습니다';
    }
  } else if (score < 90) {
    colorClass = styles.colorOrange;
    messageTitle = `${userNamePrefix}현재 계획으로는`;
    messageSub = '안정적인 노후를 위해 조금 더 준비가 필요합니다';
  }

  return (
    <motion.div 
      className={`${styles.heroCard} ${colorClass}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className={styles.heroContent}>
        <div className={styles.heroTextSection}>
          <div className={styles.heroMessageArea} style={{ marginBottom: '1rem', marginTop: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
            <h3 className={styles.heroMessageTitle} style={{ margin: 0, fontWeight: 'normal', fontSize: '1.1rem' }}>{messageTitle}</h3>
            <p className={styles.heroMessageSub} style={{ margin: 0, fontSize: '1.1rem', fontWeight: 500, color: 'rgba(255, 255, 255, 0.9)' }}>{messageSub}</p>
          </div>
        </div>
        
        <div className={styles.heroAlternativesSection}>
          <div className={styles.heroAltRow}>
            <span className={styles.heroAltLabel}>은퇴 성공 확률</span>
            <div className={styles.heroAltBarTrack}>
              <motion.div 
                className={styles.heroAltBarFill} 
                style={{ backgroundColor: 'var(--hero-color)' }}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
              />
            </div>
            <span className={styles.heroAltScore} style={{ color: 'var(--hero-color)' }}>{score}%</span>
          </div>

          {alternatives.map((alt, i) => {
            let altColor = '#EF4444'; // Red
            if (alt.score >= 90) altColor = '#10B981'; // Green
            else if (alt.score >= 70) altColor = '#F59E0B'; // Orange

            return (
              <div className={styles.heroAltRow} key={i}>
                <span className={styles.heroAltLabel}>{alt.label}</span>
                <div className={styles.heroAltBarTrack}>
                  <motion.div 
                    className={styles.heroAltBarFill} 
                    style={{ backgroundColor: altColor }}
                    initial={{ width: 0 }}
                    animate={{ width: `${alt.score}%` }}
                    transition={{ duration: 1, ease: "easeOut", delay: 0.3 + i * 0.1 }}
                  />
                </div>
                <span className={styles.heroAltScore} style={{ color: altColor }}>{alt.score}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
