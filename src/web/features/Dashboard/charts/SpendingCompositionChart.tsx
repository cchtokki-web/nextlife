'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  type LegendPayload,
  type YAxisTickContentProps,
} from 'recharts';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { computeMonthlySpendingComposition } from '../../../../core/usecases/MonthlySpendingComposition';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE } from './chartFormatters';
import { ChartCaption } from './ChartCaption';

interface SpendingCompositionChartProps {
  params: SimulationParams;
  result: SimulationResult;
  hiddenKeys: Record<string, boolean>;
  onLegendClick: (data: LegendPayload) => void;
  caption: string;
}

export function SpendingCompositionChart({ params, result, hiddenKeys, onLegendClick, caption }: SpendingCompositionChartProps) {
  const currency = params.displayCurrency;
  const spendingChartData = computeMonthlySpendingComposition(result.yearlyResults, params, result).map((d) => ({
    age: d.age,
    사적연금: d.privatePenUsed,
    국민연금: d.nationalUsed,
    배당소득: d.dividendUsed,
    기타소득: d.otherUsed,
    자산인출: d.assetWithdrawal,
    자산부족: d.shortfall,
  }));

  const rawPensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const monthlyPensionLimit =
    params.displayCurrency === 'USD' ? rawPensionLimit / 12 / params.baseExchangeRate : rawPensionLimit / 12;

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          은퇴 후 연령별 월 생활비 재원 구성 ({params.userProfile.retirementAge}세 ~ {params.userProfile.expectancy}세)
          <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
            ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준, 월별 환산)
          </span>
        </span>
      </div>
      <ChartCaption>{caption}</ChartCaption>
      <div className={styles.chartScrollWrapper}>
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spendingChartData} margin={{ top: 10, right: 43, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
              <XAxis
                dataKey="age"
                stroke="var(--foreground-muted)"
                style={{ fontSize: '0.75rem' }}
                tickFormatter={(v) => `${v}세`}
                minTickGap={10}
                scale="point"
                padding={{ left: 15, right: 15 }}
              />
              <YAxis
                stroke="var(--foreground-muted)"
                width={34}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(value: unknown) => [formatValue(Number(value), currency), '']}
                labelFormatter={(label) => (label.toString().includes('세') ? label : `${label}세 (월 생활비 구성)`)}
              />
              <Legend
                verticalAlign="top"
                height={36}
                wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }}
                onClick={onLegendClick}
              />
              <Area
                type="monotone"
                name="사적연금"
                dataKey="사적연금"
                stackId="a"
                stroke="#A855F7"
                fill="#A855F7"
                fillOpacity={0.7}
                hide={!!hiddenKeys['사적연금']}
              />
              <Area
                type="monotone"
                name="국민연금"
                dataKey="국민연금"
                stackId="a"
                stroke="#10B981"
                fill="#10B981"
                fillOpacity={0.7}
                hide={!!hiddenKeys['국민연금']}
              />
              <Area
                type="monotone"
                name="배당소득"
                dataKey="배당소득"
                stackId="a"
                stroke="#3B82F6"
                fill="#3B82F6"
                fillOpacity={0.7}
                hide={!!hiddenKeys['배당소득']}
              />
              <Area
                type="monotone"
                name="기타소득"
                dataKey="기타소득"
                stackId="a"
                stroke="#F59E0B"
                fill="#F59E0B"
                fillOpacity={0.7}
                hide={!!hiddenKeys['기타소득']}
              />
              <Area
                type="monotone"
                name="자산인출"
                dataKey="자산인출"
                stackId="a"
                stroke="#EC4899"
                fill="#EC4899"
                fillOpacity={0.7}
                hide={!!hiddenKeys['자산인출']}
              />
              <Area
                type="monotone"
                name="자산부족"
                dataKey="자산부족"
                stackId="a"
                stroke="#EF4444"
                fill="#EF4444"
                fillOpacity={0.7}
                hide={!!hiddenKeys['자산부족']}
              />
              <ReferenceLine
                y={monthlyPensionLimit}
                stroke="#F8FAFC"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `사적연금 저율과세 한도 (${formatValue(monthlyPensionLimit, currency)}/월)`,
                  fill: '#F8FAFC',
                  position: 'insideBottomLeft',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  offset: 10,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
}
