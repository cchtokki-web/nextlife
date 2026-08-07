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
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';
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
  showBreakdown: boolean;
  onToggleBreakdown: () => void;
  planAssetStatus: PlanAssetStatus;
}

const COMPARE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export function AssetGrowthChart({
  params,
  result,
  compareResults,
  hiddenKeys,
  onLegendClick,
  caption,
  showBreakdown,
  onToggleBreakdown,
  planAssetStatus,
}: AssetGrowthChartProps) {
  const currency = params.displayCurrency;
  const { yearlyResults, depletionAge } = result;
  // 전 구간 0원인 축은 정보를 주지 않는다 — 게다가 "51세 자산 고갈 발생" 배지까지 함께
  // 붙어 있어, 고갈시킬 자산이 없는 사용자에게 존재하지 않는 사건을 알린다.
  const hasNoInvestableAsset = planAssetStatus === 'no_investable_asset';

  const assetChartData = yearlyResults.map((r) => {
    const dataPoint: Record<string, number> = {
      age: r.age,
      자산총액: Math.max(0, Math.round(r.totalAssets)),
      주식자산: Math.max(0, Math.round(r.stockAssets)),
      연금자산: Math.max(0, Math.round(r.pensionAssets)),
      // ISA는 자산총액에는 들어 있는데 시리즈가 없어서, 주식+연금과 총액 사이가
      // 라벨 없는 공백으로 보였다.
      ISA자산: Math.max(0, Math.round(r.isaAssets)),
      // 쓰고 남은 현금. 성장하지 않으므로 이 띠가 두꺼워진다는 것은 "굴리지 않고 쌓아 두는
      // 돈이 늘고 있다"는 뜻이다 — 자산 총액만 봐서는 보이지 않는 정보다.
      현금: Math.max(0, Math.round(r.cashAssets)),
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

  // 정상적으로 인출 가능한 해에는 r.spending에 의료비가 이미 합산되어 있다(자산이 고갈된
  // 해에는 인출 가능한 만큼으로 깎여 spending < healthcareSpending이 될 수 있다 —
  // types.ts SimulationYearlyResult.healthcareSpending의 "예외" 참조).
  // 의료비 가정을 켠 시나리오에서만 라벨에 그 사실을 밝힌다 — 밝히지 않으면
  // "생활비를 200만원으로 넣었는데 왜 250만원이지?"가 된다.
  const hasHealthcareCost = yearlyResults.some((r) => r.healthcareSpending > 0);

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          자산 추이 시뮬레이션 (현재 ~ {params.userProfile.expectancy}세)
          <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
            ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
          </span>
        </span>
        <div className="flex items-center gap-2">
          {hasNoInvestableAsset ? (
            <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-foreground-muted">
              투자자산 없음
            </span>
          ) : depletionAge ? (
            <span className={styles.depletionAlertBadge}>
              <TrendingDown size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
              {depletionAge}세 자산 고갈 발생
            </span>
          ) : (
            <span className={styles.successBadge}>안정적인 노후 자산 유지됨</span>
          )}
          {/* 펼칠 구성(주식/연금/ISA/현금)이 전부 0이므로 토글도 의미가 없다. */}
          {!hasNoInvestableAsset && (
            <button
              type="button"
              onClick={onToggleBreakdown}
              className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-foreground-muted hover:bg-foreground/5"
            >
              {showBreakdown ? '간단히 보기' : '자산 구성 상세보기'}
            </button>
          )}
        </div>
      </div>
      <ChartCaption>{caption}</ChartCaption>
      {hasNoInvestableAsset ? (
        <p className="rounded-2xl border border-card-border bg-foreground/5 px-6 py-10 text-center text-sm text-foreground-muted">
          등록된 투자자산이 없어 자산 추이를 표시할 수 없습니다.
          <br />
          국민연금 등 고정소득만으로 생활하는 계획입니다.
        </p>
      ) : (
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
              <Area
                yAxisId="left"
                name="ISA 자산"
                type="monotone"
                dataKey="ISA자산"
                stroke="var(--success)"
                fill="transparent"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                hide={!!hiddenKeys['ISA자산']}
              />
              <Area
                yAxisId="left"
                name="현금"
                type="monotone"
                dataKey="현금"
                stroke="var(--foreground-muted)"
                fill="transparent"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                hide={!!hiddenKeys['현금']}
              />
              <Line
                yAxisId="right"
                name={hasHealthcareCost ? '월 생활비 (의료비 포함)' : '월 생활비'}
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
      )}
    </GlassCard>
  );
}
