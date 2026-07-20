import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { Sparkles, Loader2, RefreshCcw } from 'lucide-react';
import styles from './Dashboard.module.css';
import {
  UtilityBreakdown,
  StrategyRecommendation,
  UserProfile,
  InvestmentAsset,
  PrivatePension,
  NationalPension,
  OtherIncome,
  TaxSettings,
  SpendingStrategy,
} from '../../../core/entities/types';
import { getRetirementGradeColorTier, RetirementGrade } from '../../../core/entities/retirementGrade';
import { analyzeCurrentStrategy } from '../../../core/usecases/utility/utilityAnalysis';
import { UTILITY_COMPONENT_META } from './utilityComponentMeta';

interface UtilityCardProps {
  utility?: UtilityBreakdown;
  recommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
  isComputingRecommendation?: boolean;
  formatValue: (val: number) => string;
  score: number; // 은퇴 준비도 점수(자산 유지력 관점, 0~100) — 보조 지표
  retirementGrade?: RetirementGrade;
  depletionAge: number | null;
  monthlyTarget: number;
  isPro?: boolean;
  userProfile?: UserProfile;
  goalAchievementRate?: number;
  fireAge?: number | null;
  endingAssets?: number;
  assets?: InvestmentAsset[];
  privatePensions?: PrivatePension[];
  nationalPension?: NationalPension;
  otherIncomes?: OtherIncome[];
  taxSettings?: TaxSettings;
  spendingStrategy?: SpendingStrategy;
  inflationRate?: number;
  inflationMode?: 'nominal' | 'real';
}

export const UtilityCard: React.FC<UtilityCardProps> = ({
  utility,
  recommendation,
  recommendationFailed: recommendationThrewProp = false,
  isComputingRecommendation = false,
  formatValue,
  score,
  retirementGrade,
  depletionAge,
  monthlyTarget,
  isPro = false,
  userProfile,
  goalAchievementRate,
  fireAge,
  endingAssets,
  assets,
  privatePensions,
  nationalPension,
  otherIncomes,
  taxSettings,
  spendingStrategy,
  inflationRate,
  inflationMode,
}) => {
  const { data: session } = useSession();
  const userNamePrefix = session?.user?.name ? `${session.user.name}님의 ` : '';

  const [advice, setAdvice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggerFetch, setTriggerFetch] = useState(0);
  const [lastFetchKey, setLastFetchKey] = useState('');
  const [isRuleBased, setIsRuleBased] = useState(false);

  const currentKey = useMemo(() => JSON.stringify({
    score, retirementGrade, monthlyTarget, isPro, userProfile, depletionAge,
    goalAchievementRate, fireAge, endingAssets,
    assets, privatePensions, nationalPension, otherIncomes,
    taxSettings, spendingStrategy, inflationRate, inflationMode,
    utility, recommendation
  }), [
    score, retirementGrade, monthlyTarget, isPro, userProfile, depletionAge,
    goalAchievementRate, fireAge, endingAssets,
    assets, privatePensions, nationalPension, otherIncomes,
    taxSettings, spendingStrategy, inflationRate, inflationMode,
    utility, recommendation
  ]);
  const isStale = lastFetchKey !== '' && currentKey !== lastFetchKey;

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAdvice = async () => {
      setIsLoading(true);
      setError(null);
      setAdvice('');
      setIsRuleBased(false);
      setLastFetchKey(currentKey);

      try {
        const response = await fetch('/api/ai-advisor', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            score, retirementGrade, monthlyTarget, isPro, userProfile, depletionAge,
            goalAchievementRate, fireAge, endingAssets,
            assets, privatePensions, nationalPension, otherIncomes,
            taxSettings, spendingStrategy, inflationRate, inflationMode,
            utility, recommendation
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to fetch advice');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        // 모든 라인이 파싱에 실패하면 advice는 계속 빈 문자열로 남고 에러도 없이 로딩만
        // 끝나버려 카드가 조용히 빈 채로 멈춘다. 파싱 실패 여부와 실제 콘텐츠 수신 여부를
        // 추적해, 스트림이 끝났는데 콘텐츠를 하나도 못 받았다면 명시적으로 에러를 표시한다.
        let receivedContent = false;
        let hadParseFailure = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '') continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.isRuleBased) setIsRuleBased(true);
              const chunk = parsed.message?.content || parsed.response;
              if (chunk) {
                receivedContent = true;
                setAdvice((prev) => prev + chunk);
              }
            } catch (e) {
              hadParseFailure = true;
              console.warn('Failed to parse JSON line:', line);
            }
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.isRuleBased) setIsRuleBased(true);
            const chunk = parsed.message?.content || parsed.response;
            if (chunk) {
              receivedContent = true;
              setAdvice((prev) => prev + chunk);
            }
          } catch (e) {
            hadParseFailure = true;
            console.warn('Failed to parse trailing JSON buffer:', buffer, e);
          }
        }

        if (!receivedContent && hadParseFailure) {
          setError('AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Fetch aborted due to params change');
        } else {
          console.error('Error fetching AI advice:', err);
          setError('AI 의견을 가져오는 데 실패했습니다.');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchAdvice();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerFetch]);

  useEffect(() => {
    if (isStale && (isRuleBased || advice === '')) {
      setTriggerFetch(prev => prev + 1);
    }
  }, [isStale, isRuleBased, advice]);

  if (!utility) return null;

  let displayAdvice = advice;
  const emptyThoughtTag = "<|channel>thought\n<channel|>";
  if (displayAdvice.startsWith(emptyThoughtTag)) {
    displayAdvice = displayAdvice.substring(emptyThoughtTag.length);
  } else if (emptyThoughtTag.startsWith(displayAdvice)) {
    displayAdvice = "";
  }

  const colorTier = getRetirementGradeColorTier(utility.score);
  const colorClass = colorTier === 'red' ? styles.colorRed
    : colorTier === 'orange' ? styles.colorOrange
    : styles.colorGreen;
  const scoreColor = colorTier === 'red' ? '#EF4444' : colorTier === 'orange' ? '#F59E0B' : '#10B981';

  const hasImprovement = !!recommendation?.improved;
  // recommendationThrewProp: recommendStrategy() 호출 자체가 throw한 경우(page.tsx에서 감지).
  // 여기에 더해, 함수는 정상 반환됐지만 내부 후보가 전부 시뮬레이션 실패로 평가되지 못한 경우도
  // "이미 최적"과는 다른 실패 상태이므로 같은 recommendationFailed로 합쳐서 취급한다.
  const allCandidatesFailedInternally = !!recommendation
    && !recommendation.improved
    && recommendation.totalCandidateCount > 0
    && recommendation.failedCandidateCount === recommendation.totalCandidateCount;
  const recommendationFailed = recommendationThrewProp || allCandidatesFailedInternally;
  const currentStrategyAnalysis = analyzeCurrentStrategy(utility);

  return (
    <motion.div
      className={`${styles.heroCard} ${colorClass}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className={styles.heroContent}>
        <div className={styles.heroTextSection} style={{ width: '100%' }}>
          <div className={styles.heroMessageArea} style={{ marginBottom: '1rem', marginTop: 0, display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', width: '100%', gap: '8px', flexWrap: 'wrap' }}>
              <h3 className={styles.heroMessageTitle} style={{ margin: 0, fontWeight: 700, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🤖 {userNamePrefix}AI 노후 설계사 의견
              </h3>
              {isRuleBased && !isLoading && (
                <span
                  title="AI 서버 연결이 원활하지 않아 정형화된 기본 안내 문구를 표시하고 있습니다."
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    color: 'var(--hero-text-muted)',
                    border: '1px solid var(--hero-inner-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  AI 서버 연결 불가 · 기본 안내 표시 중
                </span>
              )}
            </div>

            <div style={{ filter: (isStale && !isLoading) ? 'blur(2px)' : 'none', transition: 'filter 0.3s ease', opacity: (isStale && !isLoading) ? 0.6 : 1 }}>
              {error ? (
                <p className={styles.heroMessageSub} style={{ color: 'var(--error)' }}>{error}</p>
              ) : advice === '' && isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.25rem 0' }}>
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--hero-color)' }} />
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.15 }} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--hero-color)' }} />
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.3 }} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--hero-color)' }} />
                  <span style={{ marginLeft: '8px', color: 'var(--hero-text-muted)', fontSize: '0.95rem', fontWeight: 500 }}>AI 분석 의견을 작성하고 있습니다...</span>
                </div>
              ) : (
                <p className={styles.heroMessageSub} style={{ fontSize: '1.05rem', fontWeight: 500, lineHeight: '1.6' }}>
                  {displayAdvice.split('\n').map((line, i) => {
                    const parts = line.split(/(\*\*.*?\*\*)/g);
                    return (
                      <React.Fragment key={i}>
                        {parts.map((part, j) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return (
                              <strong
                                key={j}
                                style={{
                                  color: 'var(--hero-color)',
                                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  margin: '0 2px',
                                  fontWeight: 700
                                }}
                              >
                                {part.slice(2, -2)}
                              </strong>
                            );
                          }
                          return <React.Fragment key={j}>{part}</React.Fragment>;
                        })}
                        {i < displayAdvice.split('\n').length - 1 && <br />}
                      </React.Fragment>
                    );
                  })}
                  {isLoading && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '8px', verticalAlign: 'middle' }}>
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--hero-color)' }} />
                    </span>
                  )}
                </p>
              )}
            </div>

            <AnimatePresence>
              {isStale && !isRuleBased && !isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    background: 'rgba(0, 0, 0, 0.05)',
                    borderRadius: '16px',
                    backdropFilter: 'blur(2px)'
                  }}
                >
                  <button
                    onClick={() => setTriggerFetch(prev => prev + 1)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 1rem',
                      background: 'var(--card-bg)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--hero-color)',
                      borderRadius: '20px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    }}
                  >
                    <RefreshCcw size={14} />
                    의견 업데이트
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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

          <div className={styles.heroAlternativesSection} style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--hero-text-muted)', margin: 0 }}>
              참고: 자산 유지력 관점 은퇴 준비도 {score}점{retirementGrade ? ` (${retirementGrade})` : ''}
            </p>

            {typeof goalAchievementRate === 'number' && (
              <div className={styles.heroAltRow}>
                <span className={styles.heroAltLabel}>고정소득<br />커버율</span>
                <div className={styles.heroAltBarTrack}>
                  <motion.div
                    className={styles.heroAltBarFill}
                    style={{ backgroundColor: '#6366F1' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, goalAchievementRate)}%` }}
                    transition={{ duration: 1, ease: "easeOut", delay: 0.25 }}
                  />
                </div>
                <span className={styles.heroAltScore} style={{ color: '#6366F1' }}>{goalAchievementRate}%</span>
              </div>
            )}

            {typeof goalAchievementRate === 'number' && (
              <p style={{ fontSize: '0.72rem', color: 'var(--hero-text-muted)', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
                * 고정소득 커버율은 배당·연금·기타소득 등 <strong>원금 인출을 제외한</strong> 소득만으로 목표
                생활비를 얼마나 충당하는지 나타내는 보조 지표입니다. 100% 미만이어도 자산이 고갈되지
                않는다면 원금을 계획적으로 인출하는 안정적인 은퇴 설계일 수 있습니다.
              </p>
            )}
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

          {!isComputingRecommendation && recommendationFailed && (
            <div
              style={{
                paddingTop: '1rem',
                borderTop: '1px solid var(--card-border)',
                fontSize: '0.85rem',
                color: 'var(--foreground-muted)',
              }}
            >
              🤖 AI 추천 전략을 계산하지 못했습니다. 잠시 후 다시 시도해주세요.
            </div>
          )}

          {!isComputingRecommendation && !recommendationFailed && recommendation && (
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
                      {recommendation.deltas.lifetimeConsumption >= 0 ? '+' : '-'}
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
        </div>
      </div>
    </motion.div>
  );
};

export default UtilityCard;
