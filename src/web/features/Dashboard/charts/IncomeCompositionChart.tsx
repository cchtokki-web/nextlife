'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, type LegendPayload, type YAxisTickContentProps } from 'recharts';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { PensionStartMarker } from '../../../../core/usecases/dashboard/computePensionStartMarkers';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE } from './chartFormatters';
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
  // 국민연금 개시 시점(본인/배우자). 막대는 두 사람의 국민연금을 합산해 그리기 때문에,
  // 배우자가 먼저 받기 시작하는 계획에서는 어느 해에 작은 막대가 생겼다가 다음 해에
  // 갑자기 커진다 — 기준선이 없으면 그 이유를 차트에서 읽을 방법이 없다.
  pensionStartMarkers?: PensionStartMarker[];
}

export function IncomeCompositionChart({
  params, result, hiddenKeys, onLegendClick, caption, pensionStartMarkers = [],
}: IncomeCompositionChartProps) {
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
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(value: unknown) => [formatValue(Number(value), currency), '']}
                labelFormatter={(label) => (label.toString().includes('세') ? label : `${label}세`)}
              />
              <Legend
                verticalAlign="top"
                height={36}
                wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }}
                onClick={onLegendClick}
              />
              {/* 기준선은 막대보다 먼저 선언해 막대 뒤에 깔리게 한다(recharts는 선언 순서대로 쌓는다).
                  차트 데이터에 없는 나이(예: 시뮬레이션 구간 밖)는 recharts가 조용히 무시한다. */}
              {pensionStartMarkers.map((marker) => (
                <ReferenceLine
                  key={marker.age}
                  x={marker.age}
                  stroke="var(--foreground-muted)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `${marker.age}세 ${marker.label}`,
                    fill: 'var(--foreground-muted)',
                    position: 'top',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                  }}
                />
              ))}
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
