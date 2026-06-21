import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import styles from './Dashboard.module.css';

interface CoreMetricsCardsProps {
  depletionAge: number | null;
  expectancyAge: number;
  assetAt60: number;
  monthlyTarget: number;
  isMonthlyTargetPossible: boolean;
  formatValue: (val: number) => string;
  calculatedTargetSpending?: number;
}

export const CoreMetricsCards: React.FC<CoreMetricsCardsProps> = ({
  depletionAge,
  expectancyAge,
  assetAt60,
  monthlyTarget,
  isMonthlyTargetPossible,
  formatValue,
  calculatedTargetSpending
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.3
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
  };

  return (
    <motion.div 
      className={styles.coreMetricsGrid}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Card 1: Depletion Age */}
      <motion.div variants={itemVariants} className={styles.coreMetricCard}>
        <div className={styles.coreIconWrapper}>
          <Calendar size={24} className={styles.coreIcon} />
        </div>
        <div className={styles.coreCardContent}>
          <h4 className={styles.coreCardTitle}>예상 자산 고갈 시점</h4>
          <div className={styles.coreCardValue}>
            {depletionAge ? `${depletionAge}세` : '고갈 위험 없음'}
          </div>
          <p className={styles.coreCardDesc}>
            {depletionAge 
              ? (depletionAge >= expectancyAge ? '기대수명보다 오래 유지됩니다' : `기대수명(${expectancyAge}세) 전 고갈 위험`)
              : '안정적으로 유지 가능'}
          </p>
        </div>
      </motion.div>

      {/* Card 2: Age 60 Asset */}
      <motion.div variants={itemVariants} className={styles.coreMetricCard}>
        <div className={styles.coreIconWrapper}>
          <Wallet size={24} className={styles.coreIcon} />
        </div>
        <div className={styles.coreCardContent}>
          <h4 className={styles.coreCardTitle}>60세 예상 자산</h4>
          <div className={styles.coreCardValue}>
            {formatValue(assetAt60)}
          </div>
          <p className={styles.coreCardDesc}>현재 가치 기준 환산 금액</p>
        </div>
      </motion.div>

      {/* Card 3: Living Standard */}
      <motion.div variants={itemVariants} className={styles.coreMetricCard}>
        <div className={styles.coreIconWrapper}>
          <TrendingUp size={24} className={styles.coreIcon} />
        </div>
        <div className={styles.coreCardContent}>
          <h4 className={styles.coreCardTitle}>생활 수준 진단</h4>
          <div className={styles.coreCardList}>
            <div className={styles.coreCardListItem}>
              <span className={isMonthlyTargetPossible ? styles.checkIcon : styles.crossIcon}>
                {isMonthlyTargetPossible ? '✅' : '⚠️'}
              </span>
              <span>월 {formatValue(monthlyTarget)} 생활 {isMonthlyTargetPossible ? '가능' : '부족'}</span>
            </div>
            {calculatedTargetSpending !== undefined && calculatedTargetSpending > 0 && (
              <div 
                className={styles.coreCardDesc}
                style={{ 
                  marginTop: '0.6rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '4px',
                  color: calculatedTargetSpending >= monthlyTarget ? '#10B981' : '#EF4444',
                  fontWeight: 500
                }}
              >
                {calculatedTargetSpending >= monthlyTarget ? (
                  <TrendingUp size={14} strokeWidth={2.5} />
                ) : (
                  <TrendingDown size={14} strokeWidth={2.5} />
                )}
                <span>최대 월 {formatValue(calculatedTargetSpending)} 생활 가능</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
