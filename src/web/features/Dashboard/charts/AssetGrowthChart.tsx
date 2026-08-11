'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  type LegendPayload,
  type YAxisTickContentProps,
} from 'recharts';
import { TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { PlanOutcome } from '../../../../core/usecases/dashboard/resolvePlanOutcome';
import { MonteCarloResult } from '../../../../core/entities/montecarlo';
import { formatValue, MultilineYAxisTick, RECHARTS_TOOLTIP_STYLE, Y_AXIS_WIDTH } from './chartFormatters';
import { ChartLegend, type ChartLegendItem } from './ChartLegend';
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
  // 배지가 서술할 세 사건. 예전에는 depletionAge 하나로 "고갈 / 안정" 이진 분기를 했는데,
  // 그 판정은 (a) 총자산이 다시 올라가는 계획에서 사건 자체를 놓치고 (b) 계획한 생활비를
  // 매년 못 채운 계획에 "안정적인 노후 자산 유지됨"을 붙였다.
  planOutcome: PlanOutcome;
  // 있으면 P10~P90 밴드를 겹쳐 그린다. MC가 아직이거나 미지원이면 undefined.
  monteCarlo?: MonteCarloResult;
}

const COMPARE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

// 몬테카를로 분위수 시리즈. **띠(면적)가 아니라 각각 독립적인 선으로 그린다.**
//
// 처음에는 p10~p90을 채운 팬 차트로 그렸다. 보기에는 좋았지만 두 가지가 걸렸다.
//   1. **축이 P90에 끌려간다.** 39년 뒤 상위 10%는 80억까지 벌어지는데 결정론 곡선은 10억
//      언저리라, 정작 사용자가 봐야 할 주 곡선과 P50이 바닥에 눌려 읽히지 않았다.
//   2. 띠를 만들려면 «하한»과 «폭»을 같은 stackId로 쌓아야 하는데, 그 하한은 사용자에게
//      의미가 없는 유령 시리즈라 범례와 툴팁에서 따로 걸러 내야 했다.
//
// 선 세 개로 바꾸면 둘 다 사라진다. 범례 버튼이 이미 시리즈 단위 토글이고(ChartLegend),
// recharts는 hide된 시리즈를 축 도메인 계산에서 제외하므로(3.8의 combineGraphicalItemsSettings)
// P90을 끄면 축이 곧바로 다시 맞춰진다. 사용자가 보고 싶은 경우만 골라서 볼 수 있다.
//
// 색은 의미를 따른다 — 나쁜 경우는 빨강, 좋은 경우는 초록.
const PERCENTILE_SERIES = [
  { dataKey: '하위10%', label: '나쁜 경우 (하위 10%)', color: 'var(--danger)' },
  { dataKey: '중앙값', label: '중간 경우 (중앙값)', color: 'var(--warning)' },
  { dataKey: '상위10%', label: '좋은 경우 (상위 10%)', color: 'var(--success)' },
] as const;

// 처음 화면에서 꺼 두는 분위수. 위 1번(축이 P90에 끌려간다) 때문이다 — 상위 10%는 언제든
// 범례 버튼으로 켤 수 있고, 켜는 순간 축이 그 폭에 맞춰 다시 그려진다.
//
// **하위 10%는 기본으로 켠다.** 은퇴 계획에서 사용자가 봐야 할 것은 상방이 아니라 하방이고,
// "성공률 39%"라는 숫자가 왜 나오는지는 이 선이 언제 0원에 닿는지를 보는 것이 가장 빠르다.
export const DEFAULT_HIDDEN_PERCENTILE_KEYS: Record<string, boolean> = { '상위10%': true };

// 범례 표기. 아래 <Area>/<Line> 선언의 name/dataKey/stroke/strokeDasharray와 짝을 이룬다 —
// 어긋나면 범례가 차트에 없는 색이나 모양을 말한다.
// 자산 breakdown을 접어도 항목은 남는다: 시리즈가 사라지는 게 아니라 hide될 뿐이다.
const ASSET_LEGEND: ChartLegendItem[] = [
  { dataKey: '자산총액', label: '총 자산액 (현재)', color: 'var(--primary)', shape: 'area' },
  { dataKey: '주식자산', label: '주식/ETF 자산', color: 'var(--accent)', shape: 'dashed' },
  { dataKey: '연금자산', label: '연금 자산', color: 'var(--secondary)', shape: 'dashed' },
  { dataKey: 'ISA자산', label: 'ISA 자산', color: 'var(--success)', shape: 'dashed' },
  { dataKey: '현금', label: '현금', color: 'var(--foreground-muted)', shape: 'dashed' },
];

export function AssetGrowthChart({
  params,
  result,
  compareResults,
  hiddenKeys,
  onLegendClick,
  caption,
  showBreakdown,
  onToggleBreakdown,
  planOutcome,
  monteCarlo,
}: AssetGrowthChartProps) {
  const currency = params.displayCurrency;
  const { yearlyResults } = result;
  // 전 구간 0원인 축은 정보를 주지 않는다 — 게다가 "51세 자산 고갈 발생" 배지까지 함께
  // 붙어 있어, 고갈시킬 자산이 없는 사용자에게 존재하지 않는 사건을 알린다.
  const hasNoInvestableAsset = planOutcome.assetStatus === 'no_investable_asset';

  // 분위수 선은 «간단히 보기»에서만 그린다. 구성 상세(주식/연금/ISA/현금)를 펼친 상태에
  // 세 선까지 얹으면 시리즈가 아홉 개가 되어 어느 것도 읽히지 않는다.
  const bandByAge = !showBreakdown && monteCarlo
    ? new Map(monteCarlo.assetBand.map((b) => [b.age, b]))
    : undefined;

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
    const band = bandByAge?.get(r.age);
    if (band) {
      dataPoint['하위10%'] = Math.max(0, Math.round(band.p10));
      dataPoint['중앙값'] = Math.max(0, Math.round(band.p50));
      dataPoint['상위10%'] = Math.max(0, Math.round(band.p90));
    }
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

  // 월 생활비 라벨은 의료비 포함 여부에 따라 달라지고, 비교 시나리오는 개수가 가변이다.
  // 둘 다 아래 시리즈 선언과 같은 규칙을 써야 범례와 그래프가 같은 이야기를 한다.
  const legendItems: ChartLegendItem[] = [
    ...ASSET_LEGEND,
    // 분위수 세 개를 각각 범례 버튼으로 낸다. 범례가 곧 선택 스위치다 — 보고 싶은 경우만
    // 켜면 축도 그에 맞춰 다시 그려진다(PERCENTILE_SERIES 주석 참고).
    ...(bandByAge
      ? PERCENTILE_SERIES.map((s) => ({ ...s, shape: 'dashed' as const }))
      : []),
    ...compareResults.map((comp, idx) => ({
      dataKey: `compare_${comp.id}`,
      label: `${comp.name} (비교)`,
      color: COMPARE_COLORS[idx % COMPARE_COLORS.length],
      shape: 'line' as const,
    })),
    {
      dataKey: '월생활비',
      label: hasHealthcareCost ? '월 생활비 (의료비 포함)' : '월 생활비',
      color: '#F59E0B',
      shape: 'line' as const,
    },
  ];

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          자산 추이 시뮬레이션 (현재 ~ {params.userProfile.expectancy}세)
          <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
            ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
          </span>
        </span>
        {/* 배지는 «판정»이 아니라 «사건»을 말한다. 두 사건은 독립이므로 함께 뜰 수 있다.
            예전 이진 분기가 놓치던 두 상태:
              - 총자산이 0을 찍었다가 연금 잉여로 다시 오르는 계획 → depletionAge가 잡히지
                않아 "안정적인 노후 자산 유지됨"이 붙었다.
              - 계획한 생활비를 매년 못 채운 계획 → 자산은 남으므로 역시 "유지됨"이 붙었다. */}
        <div className="flex flex-wrap items-center gap-2">
          {hasNoInvestableAsset ? (
            <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-foreground-muted">
              투자자산 없음
            </span>
          ) : (
            <>
              {planOutcome.investableDepletionAge !== null && (
                <span className={styles.depletionAlertBadge}>
                  <TrendingDown size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                  {planOutcome.investableDepletionAge}세 투자자산 소진
                </span>
              )}
              {planOutcome.spendingShortfall && (
                <span className={styles.depletionAlertBadge}>
                  생활비 부족 {planOutcome.spendingShortfall.years}년 (
                  {planOutcome.spendingShortfall.firstAge}~{planOutcome.spendingShortfall.lastAge}세)
                </span>
              )}
              {planOutcome.investableDepletionAge === null && !planOutcome.spendingShortfall && (
                <span className={styles.successBadge}>안정적인 노후 자산 유지됨</span>
              )}
            </>
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
      {!hasNoInvestableAsset && (
        <ChartLegend items={legendItems} hiddenKeys={hiddenKeys} onToggle={onLegendClick} />
      )}
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
                width={Y_AXIS_WIDTH}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} currency={currency} />}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#F59E0B"
                width={Y_AXIS_WIDTH}
                tick={(props: YAxisTickContentProps) => <MultilineYAxisTick {...props} fill="#F59E0B" currency={currency} />}
              />
              {/* name을 빈 문자열로 돌려주면 recharts가 ": 5억원"처럼 값만 나열한다 —
                  어느 줄이 무슨 자산인지 읽을 수 없었다. 시리즈 이름을 그대로 되돌려준다. */}
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(value: unknown, name: unknown) => [formatValue(Number(value), currency), String(name)]}
                labelFormatter={(label) => `${label}세`}
              />
              {/* 분위수 선을 먼저 그려 결정론 곡선 뒤에 놓는다. 각 선은 범례 버튼과 1:1로
                  대응하고(hiddenKeys[dataKey]), 꺼진 시리즈는 recharts가 축 도메인에서도
                  빼므로 P90을 끄면 축이 곧바로 다시 맞춰진다. */}
              {bandByAge && (
                <>
                  {PERCENTILE_SERIES.map((s) => (
                    <Line
                      key={s.dataKey}
                      yAxisId="left"
                      name={s.label}
                      type="monotone"
                      dataKey={s.dataKey}
                      stroke={s.color}
                      strokeDasharray="5 4"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                      hide={!!hiddenKeys[s.dataKey]}
                    />
                  ))}
                </>
              )}
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
