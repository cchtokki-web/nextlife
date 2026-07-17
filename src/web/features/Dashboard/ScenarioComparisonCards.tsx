"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { useSession, signIn } from 'next-auth/react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import styles from './ScenarioComparisonCards.module.css';

interface ScenarioResult {
  age: number;
  totalAssets: number;
}

interface ScenarioCardProps {
  title: string;
  subtitle?: string;
  highlightColor: string;
  data: ScenarioResult[];
  targetAge: number;
  formatValue: (val: number) => string;
  delay?: number;
  isBlurredOverlay?: boolean;
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({ title, subtitle, highlightColor, data, targetAge, formatValue, delay = 0, isBlurredOverlay = false }) => {
  const targetData = data.find(d => d.age === targetAge);
  const targetAssets = targetData ? targetData.totalAssets : 0;
  
  // Filter data up to target age for the chart
  const chartData = data.filter(d => d.age <= targetAge);

  const gradientId = `gradient-${title === '현재 상태 유지' ? 'base' : 'plus50'}`;

  return (
    <motion.div 
      className={styles.card}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      style={{ '--highlight-color': highlightColor } as React.CSSProperties}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ filter: isBlurredOverlay ? 'blur(8px)' : 'none', opacity: isBlurredOverlay ? 0.6 : 1, pointerEvents: isBlurredOverlay ? 'none' : 'auto', userSelect: isBlurredOverlay ? 'none' : 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className={styles.assetHighlight}>
            <span className={styles.assetLabel}>{targetAge}세 예상 자산</span>
            <strong className={styles.assetValue}>{formatValue(targetAssets)}</strong>
          </div>

          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={highlightColor} stopOpacity={0.5}/>
                    <stop offset="95%" stopColor={highlightColor} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="age" 
                  tickFormatter={(val) => `${val}세`} 
                  tick={{ fill: 'var(--foreground-muted)', fontSize: 12, opacity: 0.7 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                  scale="point"
                  padding={{ left: 15, right: 15 }}
                />
                <Tooltip 
                  formatter={(value: any) => [formatValue(Number(value) || 0), '자산']}
                  labelFormatter={(label) => `${label}세`}
                  contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', color: 'var(--foreground)' }}
                  itemStyle={{ color: highlightColor, fontWeight: 'bold' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalAssets" 
                  stroke={highlightColor} 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill={`url(#${gradientId})`} 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {isBlurredOverlay && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <button 
              onClick={() => {
                if (process.env.NEXT_PUBLIC_DEV_MODE === 'true') {
                  signIn('credentials', { email: 'dev', password: 'dev', callbackUrl: '/' });
                } else {
                  signIn('kakao', { callbackUrl: '/' });
                }
              }}
              style={{ 
                backgroundColor: '#FEE500', 
                color: '#191919', 
                padding: '0.8rem 1.2rem', 
                borderRadius: '12px', 
                fontWeight: 700, 
                fontSize: '0.95rem', 
                border: 'none', 
                cursor: 'pointer', 
                boxShadow: '0 8px 16px rgba(0,0,0,0.2)', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                wordBreak: 'keep-all'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 20px rgba(0,0,0,0.3)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 3C6.477 3 2 6.58 2 11C2 13.829 3.754 16.31 6.438 17.653L5.454 21.282C5.352 21.658 5.766 21.936 6.096 21.722L10.36 18.966C10.893 19.043 11.44 19.083 12 19.083C17.523 19.083 22 15.503 22 11C22 6.58 17.523 3 12 3Z" fill="currentColor"/>
              </svg>
              가입하고 결과 확인
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

interface ScenarioComparisonCardsProps {
  baseData: ScenarioResult[];
  plus50Data: ScenarioResult[];
  targetAge: number;
  formatValue: (val: number) => string;
}

export const ScenarioComparisonCards: React.FC<ScenarioComparisonCardsProps> = ({
  baseData,
  plus50Data,
  targetAge,
  formatValue
}) => {
  const { data: session } = useSession();
  const isDevMode = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_MODE === 'true';
  const isBlurred = !isDevMode && (!session || session.user?.provider !== 'kakao');

  return (
    <div className={styles.container}>
      <ScenarioCard
        title="현재 상태 유지"
        subtitle="현재 계획대로 저축/투자 시"
        highlightColor="#F59E0B" // Orange
        data={baseData}
        targetAge={targetAge}
        formatValue={formatValue}
        delay={0.1}
      />
      <ScenarioCard
        title="투자금 +50만원"
        subtitle="매월 50만원씩 더 저축/투자 시"
        highlightColor="#10B981" // Green
        data={plus50Data}
        targetAge={targetAge}
        formatValue={formatValue}
        delay={0.2}
        isBlurredOverlay={isBlurred}
      />
    </div>
  );
};
