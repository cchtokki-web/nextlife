import React, { useState } from 'react';
import { SimulationResult, SimulationParams } from '../../../core/entities/types';
import GlassCard from '../../components/GlassCard';
import styles from './Dashboard.module.css';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { Table, BarChart2 } from 'lucide-react';

interface YearlyChartProps {
  params: SimulationParams;
  result: SimulationResult;
}

export const YearlyChart: React.FC<YearlyChartProps> = ({ params, result }) => {
  const { yearlyResults } = result;
  const currency = params.displayCurrency;
  
  const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey;
    if (dataKey) {
      setHiddenKeys((prev) => ({
        ...prev,
        [dataKey]: !prev[dataKey]
      }));
    }
  };

  const formatValue = (val: number): string => {
    if (val === 0) return '0원';
    if (currency === 'KRW') {
      const valueInMan = Math.round(val / 10000);
      if (valueInMan === 0) return '0원';

      const eok = Math.floor(valueInMan / 10000);
      const man = valueInMan % 10000;

      const parts = [];
      if (eok > 0) parts.push(`${eok.toLocaleString()}억`);
      if (man > 0) parts.push(`${man.toLocaleString()}만`);

      return parts.join(' ') + '원';
    } else {
      return `$${Math.round(val).toLocaleString()}`;
    }
  };

  const formatShortValue = (val: number): string => {
    if (val <= 0) return '0원';
    if (currency === 'KRW') {
      if (val >= 100000000) {
        const num = val / 100000000;
        return `${num % 1 === 0 ? num : num.toFixed(1)}억원`;
      }
      return `${Math.round(val / 10000)}만원`;
    } else {
      if (val >= 1000) {
        const num = val / 1000;
        return `$ ${num % 1 === 0 ? num : num.toFixed(0)}K`;
      }
      return `$ ${Math.round(val)}`;
    }
  };

  if (!yearlyResults || yearlyResults.length === 0) return null;

  const chartData = yearlyResults.map((r) => ({
    age: r.age,
    year: r.year,
    '세전 총소득': Math.round(r.preTaxTotalIncome),
    '배당소득세': Math.round(r.dividendTaxPaid),
    '연금소득세': Math.round(r.pensionTaxPaid),
    '국민연금세': Math.round(r.nationalPensionTaxPaid),
    '종합과세 추가': Math.round(r.comprehensiveTaxPaid),
    '건보료 추가': Math.round(r.healthInsurancePaid),
    '세후 총소득': Math.round(r.totalIncome),
    '생활비 지출': Math.round(r.spending),
    '잔여 자산액': Math.round(r.totalAssets),
  }));

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          <BarChart2 size={20} color="var(--primary)" style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          연도별 상세 세금 및 소득 내역
        </span>
      </div>
      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
            <XAxis 
              dataKey="age" 
              stroke="var(--foreground-muted)"
              style={{ fontSize: '0.75rem' }}
              tickFormatter={(v) => `${v}세`}
              minTickGap={15}
            />
            <YAxis 
              yAxisId="left"
              stroke="var(--foreground-muted)"
              style={{ fontSize: '0.75rem' }}
              width={65}
              tickFormatter={(v) => formatShortValue(v)}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="var(--foreground-muted)"
              style={{ fontSize: '0.75rem' }}
              width={65}
              tickFormatter={(v) => formatShortValue(v)}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(17, 24, 39, 0.85)',
                border: '1px solid var(--card-border)',
                borderRadius: '12px',
                color: 'white',
                fontFamily: 'var(--font-main)',
                fontSize: '0.8rem',
              }}
              formatter={(value: any, name: string) => [formatValue(Number(value)), name]}
              labelFormatter={(label, payload) => {
                const year = payload && payload.length > 0 ? payload[0].payload.year : '';
                return `${label}세 (${year}년)`;
              }}
            />
            <Legend 
              verticalAlign="top" 
              height={36} 
              wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }}
              onClick={handleLegendClick}
            />
            
            {/* Taxes (Stacked Bars) */}
            <Bar yAxisId="left" name="배당소득세" dataKey="배당소득세" stackId="tax" fill="#FCA5A5" hide={!!hiddenKeys['배당소득세']} />
            <Bar yAxisId="left" name="연금소득세" dataKey="연금소득세" stackId="tax" fill="#F87171" hide={!!hiddenKeys['연금소득세']} />
            <Bar yAxisId="left" name="국민연금세" dataKey="국민연금세" stackId="tax" fill="#EF4444" hide={!!hiddenKeys['국민연금세']} />
            <Bar yAxisId="left" name="종합과세 추가" dataKey="종합과세 추가" stackId="tax" fill="#F59E0B" hide={!!hiddenKeys['종합과세 추가']} />
            <Bar yAxisId="left" name="건보료 추가" dataKey="건보료 추가" stackId="tax" fill="#D97706" hide={!!hiddenKeys['건보료 추가']} />
            
            {/* Incomes & Spending (Lines) */}
            <Line yAxisId="left" name="세전 총소득" type="monotone" dataKey="세전 총소득" stroke="#60A5FA" strokeWidth={2} dot={false} hide={!!hiddenKeys['세전 총소득']} />
            <Line yAxisId="left" name="세후 총소득" type="monotone" dataKey="세후 총소득" stroke="#10B981" strokeWidth={2} dot={false} hide={!!hiddenKeys['세후 총소득']} />
            <Line yAxisId="left" name="생활비 지출" type="monotone" dataKey="생활비 지출" stroke="#A855F7" strokeWidth={2} dot={false} hide={!!hiddenKeys['생활비 지출']} strokeDasharray="5 5" />
            
            {/* Assets (Right Axis Line) */}
            <Line yAxisId="right" name="잔여 자산액" type="monotone" dataKey="잔여 자산액" stroke="var(--primary)" strokeWidth={2} dot={false} hide={!!hiddenKeys['잔여 자산액']} />

          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
};
