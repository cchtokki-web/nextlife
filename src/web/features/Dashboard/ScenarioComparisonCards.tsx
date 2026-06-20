import React from 'react';
import { motion } from 'framer-motion';
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
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({ title, subtitle, highlightColor, data, targetAge, formatValue, delay = 0 }) => {
  const targetData = data.find(d => d.age === targetAge);
  const targetAssets = targetData ? targetData.totalAssets : 0;
  
  // Filter data up to target age for the chart
  const chartData = data.filter(d => d.age <= targetAge);

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
      
      <div className={styles.assetHighlight}>
        <span className={styles.assetLabel}>{targetAge}세 예상 자산</span>
        <strong className={styles.assetValue}>{formatValue(targetAssets)}</strong>
      </div>

      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={highlightColor} stopOpacity={0.5}/>
                <stop offset="95%" stopColor={highlightColor} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="age" 
              tickFormatter={(val) => `${val}세`} 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <Tooltip 
              formatter={(value: any) => [formatValue(Number(value) || 0), '자산']}
              labelFormatter={(label) => `${label}세`}
              contentStyle={{ backgroundColor: '#1A1D27', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
              itemStyle={{ color: highlightColor, fontWeight: 'bold' }}
            />
            <Area 
              type="monotone" 
              dataKey="totalAssets" 
              stroke={highlightColor} 
              strokeWidth={3}
              fillOpacity={1} 
              fill={`url(#gradient-${title})`} 
            />
          </AreaChart>
        </ResponsiveContainer>
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
      />
    </div>
  );
};
