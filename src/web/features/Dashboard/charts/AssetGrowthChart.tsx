'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  type LegendPayload,
  type YAxisTickContentProps,
} from 'recharts';
import { TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE } from './chartFormatters';
import { ChartCaption } from './ChartCaption';

interface CompareResultEntry {
  id: string;
  name: string;
  result: SimulationResult;
}

interface AssetGrowthChartProps {
  params: SimulationParams;
  result: SimulationResult;
  compareResults: CompareResultEntry[];
  hiddenKeys: Record<string, boolean>;
  onLegendClick: (data: LegendPayload) => void;
  caption: string;
}

const COMPARE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export function AssetGrowthChart({
  params,
  result,
  compareResults,
  hiddenKeys,
  onLegendClick,
  caption,
}: AssetGrowthChartProps) {
  const currency = params.displayCurrency;
  const { yearlyResults, depletionAge } = result;

  const assetChartData = yearlyResults.map((r) => {
    const dataPoint: Record<string, number> = {
      age: r.age,
      자산총액: Math.max(0, Math.round(r.totalAssets)),
      주식자산: Math.max(0, Math.round(r.stockAssets)),
      연금자산: Math.max(0, Math.round(r.pensionAssets)),
      월생활비: Math.max(0, Math.round(r.spending / 12)),
    };
    compareResults.forEach((comp) => {
      const compYear = comp.result.yearlyResults.find((yr) => yr.age === r.age);
      if (compYear) {
        dataPoint[`compare_${comp.id}`] = Math.max(0, Math.round(compYear.totalAssets));
      }
    });
    return dataPoint;
  });

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          자산 추이 시뮬레이션 (현재 ~ {params.userProfile.expectancy}세)
          <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
            ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
          </span>
        </span>
        {depletionAge ? (
          <span className={styles.depletionAlertBadge}>
            <TrendingDown size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
            {depletionAge}세 자산 고갈 발생
          </span>
        ) : (
          <span className={styles.successBadge}>안정적인 노후 자산 유지됨</span>
        )}
      </div>
      <ChartCaption>{caption}</ChartCaption>
      <div className={styles.chartScrollWrapper}>
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={assetChartData} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalAssetColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
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
                yAxisId="left"
                stroke="var(--foreground-muted)"
                width={34}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#F59E0B"
                width={38}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} fill="#F59E0B" currency={currency} />}
              />
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(value: unknown) => [formatValue(Number(value), currency), '']}
                labelFormatter={(label) => `${label}세`}
              />
              <Legend
                verticalAlign="top"
                height={36}
                wrapperStyle={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', cursor: 'pointer' }}
                onClick={onLegendClick}
              />
              <Area
                yAxisId="left"
                name="총 자산액 (현재)"
                type="monotone"
                dataKey="자산총액"
                stroke="var(--primary)"
                fillOpacity={1}
                fill="url(#totalAssetColor)"
                strokeWidth={3}
                hide={!!hiddenKeys['자산총액']}
              />
              {compareResults.map((comp, idx) => (
                <Line
                  key={comp.id}
                  yAxisId="left"
                  name={`${comp.name} (비교)`}
                  type="monotone"
                  dataKey={`compare_${comp.id}`}
                  stroke={COMPARE_COLORS[idx % COMPARE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  hide={!!hiddenKeys[`compare_${comp.id}`]}
                />
              ))}
              <Area
                yAxisId="left"
                name="주식/ETF 자산"
                type="monotone"
                dataKey="주식자산"
                stroke="var(--accent)"
                fill="transparent"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                hide={!!hiddenKeys['주식자산']}
              />
              <Area
                yAxisId="left"
                name="연금 자산"
                type="monotone"
                dataKey="연금자산"
                stroke="var(--secondary)"
                fill="transparent"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                hide={!!hiddenKeys['연금자산']}
              />
              <Line
                yAxisId="right"
                name="월 생활비"
                type="monotone"
                dataKey="월생활비"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                hide={!!hiddenKeys['월생활비']}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
}
