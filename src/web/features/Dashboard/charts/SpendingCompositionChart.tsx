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

// 스택 순서와 같은 순서로 나열해야 툴팁과 그래프가 같은 이야기를 한다.
const SOURCE_KEYS = ['사적연금', '국민연금', '배당소득', '기타소득', '자산인출', '자산부족'] as const;

export interface SpendingChartRow {
  age: number;
  목표생활비: number;
  사적연금: number;
  국민연금: number;
  배당소득: number;
  기타소득: number;
  자산인출: number;
  자산부족: number;
}

// recharts 기본 툴팁은 시리즈를 그대로 나열할 뿐이라, 사용자가 큰 빨간 '자산부족' 띠를 봐도
// "목표가 얼마인데 얼마가 부족한지"를 알 수 없었다(0원짜리 재원 줄까지 함께 나열돼 더 읽기
// 어려웠다). 목표 금액과 충당률을 함께 보여주고, 0원인 재원은 생략한다.
export function SpendingCompositionTooltip({
  active, label, rows, currency,
}: {
  active?: boolean;
  label?: string | number;
  rows: SpendingChartRow[];
  currency: SimulationParams['displayCurrency'];
}) {
  if (!active) return null;
  const row = rows.find((r) => r.age === Number(label));
  if (!row) return null;

  const covered = Math.max(0, row.목표생활비 - row.자산부족);
  // 목표가 0인 해(예: 가구 전원 사망 이후 구간)에는 비율이 성립하지 않는다.
  const coverageRate = row.목표생활비 > 0 ? Math.round((covered / row.목표생활비) * 100) : null;

  return (
    <div style={{ ...RECHARTS_TOOLTIP_STYLE, padding: '10px 12px' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{row.age}세 (월 생활비 구성)</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span>목표 생활비</span>
        <strong>{formatValue(row.목표생활비, currency)}</strong>
      </div>
      {SOURCE_KEYS.filter((key) => row[key] > 0).map((key) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={key === '자산부족' ? { color: '#F87171' } : undefined}>{key}</span>
          <span style={key === '자산부족' ? { color: '#F87171' } : undefined}>{formatValue(row[key], currency)}</span>
        </div>
      ))}
      {coverageRate !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 6 }}>
          <span>충당률</span>
          <strong>{coverageRate}%</strong>
        </div>
      )}
    </div>
  );
}

export function SpendingCompositionChart({ params, result, hiddenKeys, onLegendClick, caption }: SpendingCompositionChartProps) {
  const currency = params.displayCurrency;
  const spendingChartData: SpendingChartRow[] = computeMonthlySpendingComposition(result.yearlyResults, params, result).map((d) => ({
    age: d.age,
    // 차트에 그리지는 않는다(재원을 쌓은 높이가 곧 목표라 선을 겹쳐도 정보가 늘지 않는다).
    // 툴팁이 "얼마 중 얼마"를 말하기 위해서만 싣는다.
    목표생활비: d.targetMonthly,
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
                content={(props) => (
                  <SpendingCompositionTooltip
                    active={props.active}
                    label={props.label}
                    rows={spendingChartData}
                    currency={currency}
                  />
                )}
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
