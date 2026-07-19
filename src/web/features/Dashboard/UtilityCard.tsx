import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2 } from 'lucide-react';
import GlassCard from '../../components/GlassCard';
import styles from './Dashboard.module.css';
import { UtilityBreakdown, StrategyRecommendation } from '../../../core/entities/types';
import { getRetirementGradeColorTier } from '../../../core/entities/retirementGrade';
import { analyzeCurrentStrategy } from '../../../core/usecases/utility/utilityAnalysis';
import { UTILITY_COMPONENT_META } from './utilityComponentMeta';

interface UtilityCardProps {
  utility?: UtilityBreakdown;
  recommendation?: StrategyRecommendation;
  isComputingRecommendation?: boolean;
  formatValue: (val: number) => string;
}

export const UtilityCard: React.FC<UtilityCardProps> = ({
  utility,
  recommendation,
  isComputingRecommendation = false,
  formatValue,
}) => {
  if (!utility) return null;

  const colorTier = getRetirementGradeColorTier(utility.score);
  const scoreColor = colorTier === 'red' ? '#EF4444' : colorTier === 'orange' ? '#F59E0B' : '#10B981';

  const hasImprovement = !!recommendation && recommendation.recommendedUtility.score > utility.score;
  const currentStrategyAnalysis = analyzeCurrentStrategy(utility);

  return (
    <GlassCard className={styles.chartCard} glowColor="primary">
      <div className={styles.chartHeader} style={{ marginBottom: '0.75rem' }}>
        <span className={styles.chartTitle} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={18} color={scoreColor} />
          ★★★★★ 은퇴 성공 가능성 (Lifetime Utility Score)
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '2.4rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
          {utility.score}
        </span>
        <span style={{ fontSize: '1rem', color: 'var(--foreground-muted)' }}>/ 100점</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
        {UTILITY_COMPONENT_META.map(({ key, label, max, color }) => {
          const value = utility.components[key];
          const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
          return (
            <div key={key} className={styles.heroAltRow}>
              <span className={styles.heroAltLabel}>{label}</span>
              <div className={styles.heroAltBarTrack}>
                <motion.div
                  className={styles.heroAltBarFill}
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <span className={styles.heroAltScore} style={{ color }}>
                {value}/{max}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          paddingTop: '0.9rem',
          borderTop: '1px solid var(--card-border)',
          marginBottom: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>📋 현재 전략 분석</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#10B981' }}>장점</span>
            <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {currentStrategyAnalysis.strengths.map((s, i) => (
                <li key={i} style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#F59E0B' }}>단점</span>
            <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {currentStrategyAnalysis.weaknesses.map((w, i) => (
                <li key={i} style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {isComputingRecommendation && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--foreground-muted)', fontSize: '0.85rem' }}>
          <Loader2 size={14} className="animate-spin" />
          AI가 최적 인출 전략을 탐색하고 있습니다...
        </div>
      )}

      {!isComputingRecommendation && recommendation && (
        <div
          style={{
            paddingTop: '1rem',
            borderTop: '1px solid var(--card-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
              🤖 AI 추천 전략
            </span>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: hasImprovement ? '#10B981' : 'var(--foreground-muted)' }}>
              {hasImprovement
                ? `Utility ${utility.score}점 → ${recommendation.recommendedUtility.score}점`
                : '현재 전략 유지 권장'}
            </span>
          </div>

          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {recommendation.reasons.map((reason, i) => (
              <li key={i} style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
                {reason}
              </li>
            ))}
          </ul>

          {hasImprovement && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '0.5rem',
                marginTop: '0.4rem',
                fontSize: '0.78rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--foreground-muted)' }}>평생 소비 변화</span>
                <div style={{ fontWeight: 700, color: recommendation.deltas.lifetimeConsumption >= 0 ? '#10B981' : '#EF4444' }}>
                  {recommendation.deltas.lifetimeConsumption >= 0 ? '+' : ''}
                  {formatValue(Math.abs(recommendation.deltas.lifetimeConsumption))}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--foreground-muted)' }}>평생 총세금 변화</span>
                <div style={{ fontWeight: 700, color: recommendation.deltas.totalTax <= 0 ? '#10B981' : '#F59E0B' }}>
                  {recommendation.deltas.totalTax >= 0 ? '+' : '-'}
                  {formatValue(Math.abs(recommendation.deltas.totalTax))}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--foreground-muted)' }}>사망 시 연금잔액 변화</span>
                <div style={{ fontWeight: 700, color: recommendation.deltas.pensionEndingBalance <= 0 ? '#10B981' : '#F59E0B' }}>
                  {recommendation.deltas.pensionEndingBalance >= 0 ? '+' : '-'}
                  {formatValue(Math.abs(recommendation.deltas.pensionEndingBalance))}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--foreground-muted)' }}>사망 시 총자산 변화</span>
                <div style={{ fontWeight: 700, color: recommendation.deltas.endingAssets <= 0 ? '#10B981' : '#F59E0B' }}>
                  {recommendation.deltas.endingAssets >= 0 ? '+' : '-'}
                  {formatValue(Math.abs(recommendation.deltas.endingAssets))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
};

export default UtilityCard;
