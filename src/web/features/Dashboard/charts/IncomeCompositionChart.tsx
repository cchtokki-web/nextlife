'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, type LegendPayload, type YAxisTickContentProps } from 'recharts';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { computeMonthlySpendingComposition } from '../../../../core/usecases/MonthlySpendingComposition';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE, Y_AXIS_WIDTH } from './chartFormatters';
import { ChartLegend, legendColorOf, type ChartLegendItem } from './ChartLegend';
import { ChartCaption } from './ChartCaption';

// recharts는 Bar의 label render prop에 대한 공개 타입을 제공하지 않는다 — 실제 런타임에
// 전달되는 필드 중 이 컴포넌트가 실제로 쓰는 것만 명시적으로 선언한다.
interface BarLabelRenderProps {
  x: number;
  y: number;
  width: number;
  index: number;
}

interface IncomeCompositionChartProps {
  params: SimulationParams;
  result: SimulationResult;
  hiddenKeys: Record<string, boolean>;
  onLegendClick: (data: LegendPayload) => void;
  caption: string;
  // 국민연금 개시 나이(본인 기준). 그 해부터 막대가 갑자기 커지는 이유를 차트에서
  // 읽을 수 있게 세로 기준선을 그린다. 수령액이 0이면 넘기지 않아 기준선도 그려지지 않는다.
  nationalPensionStartAge?: number;
}

const INCOME_KEYS = ['국민연금', '사적연금', '배당소득', '기타소득'] as const;

// 범례 표기. 아래 <Bar> 선언의 name/fill과 짝을 이룬다.
export const INCOME_LEGEND: ChartLegendItem[] = [
  { dataKey: '국민연금', label: '국민연금', color: '#10B981' },
  { dataKey: '사적연금', label: '사적연금', color: '#A855F7' },
  { dataKey: '배당소득', label: '배당소득', color: '#3B82F6' },
  { dataKey: '기타소득', label: '기타소득', color: '#F59E0B' },
];

// 범례 아래로 추가로 비우는 여백(px). 이 차트만 막대 위에 ⚠️ 표시를 그리고(Bar label의
// `y - 8`) 국민연금 개시 기준선 라벨을 플롯 최상단에 얹기 때문에, 범례 높이만큼만 비우면
// 그 둘이 첫 눈금선에 닿는다.
const BAR_LABEL_HEADROOM = 12;

export interface IncomeChartRow {
  age: number;
  국민연금: number;
  사적연금: number;
  배당소득: number;
  기타소득: number;
  hasTaxWarning: boolean;
  // 그해 목표 월 생활비(은퇴 후에만 존재). 소득이 목표의 몇 %인지 말하기 위한 것이고,
  // 물가·의료비 규칙은 computeMonthlySpendingComposition이 이미 반영해 둔다.
  targetMonthly?: number;
  fixedIncomeCoverageRate?: number;
}

// recharts 기본 툴팁은 시리즈를 그대로 나열할 뿐이라, 0원인 소득원까지 함께 찍혀
// ": 0원 / : 0원 / : 0원"으로 읽혔다(formatter가 name을 빈 문자열로 만들고 있었다).
// 항목 이름을 되살리고, 0원 줄을 빼고, 은퇴 후에는 목표 생활비 대비 충당률을 덧붙인다.
export function IncomeCompositionTooltip({
  active, label, rows, currency,
}: {
  active?: boolean;
  label?: string | number;
  rows: IncomeChartRow[];
  currency: SimulationParams['displayCurrency'];
}) {
  if (!active) return null;
  const row = rows.find((r) => r.age === Number(label));
  if (!row) return null;

  const total = INCOME_KEYS.reduce((sum, key) => sum + row[key], 0);
  const coverageRate = row.fixedIncomeCoverageRate === undefined
    ? null
    : Math.round(row.fixedIncomeCoverageRate * 100);

  return (
    <div style={{ ...RECHARTS_TOOLTIP_STYLE, padding: '10px 12px' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{row.age}세</div>
      {/* 막대와 같은 색으로 말한다. 색이 없으면 사용자가 「어느 줄이 어느 띠인가」를
          눈으로 이어야 한다 — 소득원이 넷이고 스택이라 그 잇기가 특히 어렵다. */}
      {INCOME_KEYS.filter((key) => row[key] > 0).map((key) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: legendColorOf(INCOME_LEGEND, key) }}>{key}</span>
          <span style={{ color: legendColorOf(INCOME_LEGEND, key) }}>{formatValue(row[key], currency)}</span>
        </div>
      ))}
      {total === 0 && <div style={{ opacity: 0.7 }}>이 해에는 연금·배당·기타소득이 없습니다.</div>}
      {coverageRate !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 6 }}>
          <span>목표 생활비 충당률</span>
          <strong>{coverageRate}%</strong>
        </div>
      )}
    </div>
  );
}

export function IncomeCompositionChart({
  params, result, hiddenKeys, onLegendClick, caption, nationalPensionStartAge,
}: IncomeCompositionChartProps) {
  const currency = params.displayCurrency;
  // 목표 생활비는 은퇴 후 구간에만 정의된다. 나이로 색인해 두고 툴팁에서 찾아 쓴다 —
  // 화면이 물가·의료비 규칙을 복제하지 않게 하기 위해 이 usecase를 재사용한다.
  const targetByAge = new Map(
    computeMonthlySpendingComposition(result.yearlyResults, params, result)
      .map((d) => [d.age, d] as const)
  );
  const pensionChartData: IncomeChartRow[] = result.yearlyResults.map((r) => ({
    age: r.age,
    국민연금: Math.round(r.nationalPensionIncome),
    사적연금: Math.round(r.privatePensionIncome),
    배당소득: Math.round(r.dividendIncome),
    기타소득: Math.round(r.otherIncome),
    hasTaxWarning: r.hasTaxWarning,
    targetMonthly: targetByAge.get(r.age)?.targetMonthly,
    fixedIncomeCoverageRate: targetByAge.get(r.age)?.fixedIncomeCoverageRate,
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
      <ChartLegend items={INCOME_LEGEND} hiddenKeys={hiddenKeys} onToggle={onLegendClick} />
      <div className={styles.chartScrollWrapper}>
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pensionChartData} margin={{ top: BAR_LABEL_HEADROOM, right: 43, left: 0, bottom: 0 }}>
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
                width={Y_AXIS_WIDTH}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <Tooltip
                content={(props) => (
                  <IncomeCompositionTooltip
                    active={props.active}
                    label={props.label}
                    rows={pensionChartData}
                    currency={currency}
                  />
                )}
              />
              {/* 기준선은 막대보다 먼저 선언해 막대 뒤에 깔리게 한다(recharts는 선언 순서대로 쌓는다).
                  차트 데이터에 없는 나이(예: 시뮬레이션 구간 밖)는 recharts가 조용히 무시한다. */}
              {nationalPensionStartAge !== undefined && (
                <ReferenceLine
                  x={nationalPensionStartAge}
                  stroke="var(--foreground-muted)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `${nationalPensionStartAge}세 국민연금 시작`,
                    fill: 'var(--foreground-muted)',
                    position: 'top',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                  }}
                />
              )}
              <Bar name="국민연금" dataKey="국민연금" stackId="a" fill="#10B981" hide={!!hiddenKeys['국민연금']} />
              <Bar name="사적연금" dataKey="사적연금" stackId="a" fill="#A855F7" hide={!!hiddenKeys['사적연금']} />
              <Bar name="배당소득" dataKey="배당소득" stackId="a" fill="#3B82F6" hide={!!hiddenKeys['배당소득']} />
              <Bar
                name="기타소득"
                dataKey="기타소득"
                stackId="a"
                fill="#F59E0B"
                hide={!!hiddenKeys['기타소득']}
                label={(props: unknown) => {
                  // recharts는 Bar label render prop의 index/rect 좌표에 대한 공개 타입을 제공하지
                  // 않는다(공식 Props 타입에 index 필드 자체가 없음) — 실제 런타임 shape을 명시한
                  // BarLabelRenderProps로 좁혀서 쓴다.
                  const { x, y, width, index } = props as BarLabelRenderProps;
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
