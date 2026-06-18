import React from 'react';
import { motion } from 'framer-motion';
import styles from './Dashboard.module.css';

interface HeroSummaryCardProps {
  score: number; // 0 ~ 100
  expectancyAge: number;
  alternatives?: { label: string; score: number }[];
}

export const HeroSummaryCard: React.FC<HeroSummaryCardProps> = ({ score, expectancyAge, alternatives = [] }) => {
  let colorClass = styles.colorGreen;
  let messageTitle = '현재 계획으로는';
  let messageSub = '노후 자산이 안정적으로 유지될 가능성이 높습니다.';

  if (score < 70) {
    colorClass = styles.colorRed;
    messageTitle = '⚠️ 현재 계획으로는';
    messageSub = '노후 생활비가 부족할 가능성이 있습니다';
  } else if (score < 90) {
    colorClass = styles.colorOrange;
    messageTitle = '현재 계획으로는';
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
          <div className={styles.heroMessageArea} style={{ marginBottom: '1rem', marginTop: 0 }}>
            <h3 className={styles.heroMessageTitle}>{messageTitle}</h3>
            <p className={styles.heroMessageSub}>{messageSub}</p>
          </div>
        </div>
        
        <div className={styles.heroAlternativesSection}>
          <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '0.25rem', fontWeight: 600, textAlign: 'right', letterSpacing: '-0.5px' }}>은퇴 성공 확률</div>
          <div className={styles.heroAltRow}>
            <span className={styles.heroAltLabel}>현재 상태</span>
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
