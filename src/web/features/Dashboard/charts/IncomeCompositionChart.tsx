'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, type LegendPayload } from 'recharts';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE } from './chartFormatters';
import { ChartCaption } from './ChartCaption';

interface IncomeCompositionChartProps {
  params: SimulationParams;
  result: SimulationResult;
  hiddenKeys: Record<string, boolean>;
  onLegendClick: (data: LegendPayload) => void;
  caption: string;
}

export function IncomeCompositionChart({ params, result, hiddenKeys, onLegendClick, caption }: IncomeCompositionChartProps) {
  const currency = params.displayCurrency;
  const pensionChartData = result.yearlyResults.map((r) => ({
    age: r.age,
    국민연금: Math.round(r.nationalPensionIncome),
    사적연금: Math.round(r.privatePensionIncome),
    배당소득: Math.round(r.dividendIncome),
    기타소득: Math.round(r.otherIncome),
    hasTaxWarning: r.hasTaxWarning,
  }));

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          연령별 소득원 구성 (현재 ~ {params.userProfile.expectancy}세)
          <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
            ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
          </span>
        </span>
        {pensionChartData.some((d) => d.hasTaxWarning) && (
          <span style={{ fontSize: '0.75rem', color: '#EF4444', fontWeight: 600 }}>
            ⚠️ 금융소득종합과세 위험(세전 배당소득 연 2,000만원 초과) 연도
          </span>
        )}
      </div>
      <ChartCaption>{caption}</ChartCaption>
      <div className={styles.chartScrollWrapper}>
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pensionChartData} margin={{ top: 24, right: 43, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
              <XAxis
                dataKey="age"
                stroke="var(--foreground-muted)"
                style={{ fontSize: '0.75rem' }}
                tickFormatter={(v) => `${v}세`}
                minTickGap={15}
                scale="point"
                padding={{ left: 15, right: 15 }}
              />
              <YAxis
                stroke="var(--foreground-muted)"
                width={34}
                tick={(props: any) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(value: any) => [formatValue(Number(value), currency), '']}
                labelFormatter={(label) => (label.toString().includes('세') ? label : `${label}세`)}
              />
              <Legend
                verticalAlign="top"
                height={36}
                wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }}
                onClick={onLegendClick}
              />
              <Bar name="국민연금" dataKey="국민연금" stackId="a" fill="#10B981" hide={!!hiddenKeys['국민연금']} />
              <Bar name="사적연금" dataKey="사적연금" stackId="a" fill="#A855F7" hide={!!hiddenKeys['사적연금']} />
              <Bar name="배당소득" dataKey="배당소득" stackId="a" fill="#3B82F6" hide={!!hiddenKeys['배당소득']} />
              <Bar
                name="기타소득"
                dataKey="기타소득"
                stackId="a"
                fill="#F59E0B"
                hide={!!hiddenKeys['기타소득']}
                label={(props: any) => {
                  const { x, y, width, index } = props;
                  if (!pensionChartData[index]?.hasTaxWarning) return <React.Fragment key={index} />;
                  return (
                    <text key={index} x={x + width / 2} y={y - 8} textAnchor="middle" fontSize="12" fill="#EF4444">
                      ⚠️
                    </text>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
}
