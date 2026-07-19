import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCcw } from 'lucide-react';
import styles from './Dashboard.module.css';
import { UserProfile, InvestmentAsset, PrivatePension, NationalPension, OtherIncome, TaxSettings, SpendingStrategy, UtilityBreakdown, StrategyRecommendation } from '../../../core/entities/types';
import { getRetirementGradeColorTier, RetirementGrade } from '../../../core/entities/retirementGrade';

interface HeroSummaryCardProps {
  score: number; // 0 ~ 100
  retirementGrade?: RetirementGrade;
  expectancyAge: number;
  depletionAge: number | null;
  alternatives?: { label: string; score: number }[];
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
  utility?: UtilityBreakdown;
  recommendation?: StrategyRecommendation;
}

export const HeroSummaryCard: React.FC<HeroSummaryCardProps> = ({
  score,
  retirementGrade,
  expectancyAge,
  depletionAge,
  alternatives = [],
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
  utility,
  recommendation
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
                setAdvice((prev) => prev + chunk);
              }
            } catch (e) {
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
              setAdvice((prev) => prev + chunk);
            }
          } catch (e) {
            // Ignore
          }
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

  let displayAdvice = advice;
  const emptyThoughtTag = "<|channel>thought\n<channel|>";
  if (displayAdvice.startsWith(emptyThoughtTag)) {
    displayAdvice = displayAdvice.substring(emptyThoughtTag.length);
  } else if (emptyThoughtTag.startsWith(displayAdvice)) {
    displayAdvice = "";
  }

  const colorTier = getRetirementGradeColorTier(score);
  const colorClass = colorTier === 'red' ? styles.colorRed
    : colorTier === 'orange' ? styles.colorOrange
    : styles.colorGreen;

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
            <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', width: '100%' }}>
              <h3 className={styles.heroMessageTitle} style={{ margin: 0, fontWeight: 700, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🤖 {userNamePrefix}AI 노후 설계사 의견
              </h3>
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
        </div>
        
        <div className={styles.heroAlternativesSection}>
          <div className={styles.heroAltRow}>
            <span className={styles.heroAltLabel}>은퇴 준비도 점수</span>
            <div className={styles.heroAltBarTrack}>
              <motion.div
                className={styles.heroAltBarFill}
                style={{ backgroundColor: 'var(--hero-color)' }}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
              />
            </div>
            <span className={styles.heroAltScore} style={{ color: 'var(--hero-color)' }}>{score}점</span>
            {retirementGrade && (
              <span className={styles.heroGradeBadge} style={{ color: 'var(--hero-color)', borderColor: 'var(--hero-color)' }}>
                {retirementGrade}
              </span>
            )}
          </div>

          {typeof goalAchievementRate === 'number' && (
            <div className={styles.heroAltRow}>
              <span className={styles.heroAltLabel}>고정소득<br/>커버율</span>
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

          {alternatives.map((alt, i) => {
            const altTier = getRetirementGradeColorTier(alt.score);
            const altColor = altTier === 'green' ? '#10B981' : altTier === 'orange' ? '#F59E0B' : '#EF4444';

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

          {typeof goalAchievementRate === 'number' && (
            <p style={{ fontSize: '0.72rem', color: 'var(--hero-text-muted)', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
              * 고정소득 커버율은 배당·연금·기타소득 등 <strong>원금 인출을 제외한</strong> 소득만으로 목표
              생활비를 얼마나 충당하는지 나타내는 보조 지표입니다. 100% 미만이어도 자산이 고갈되지
              않는다면 원금을 계획적으로 인출하는 안정적인 은퇴 설계일 수 있습니다.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
};
