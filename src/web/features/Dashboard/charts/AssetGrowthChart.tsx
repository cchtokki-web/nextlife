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
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { PlanOutcome } from '../../../../core/usecases/dashboard/resolvePlanOutcome';
import { MonteCarloAssetBandYear, MonteCarloResult } from '../../../../core/entities/montecarlo';
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
  // 이제 이 차트가 여기서 읽는 것은 assetStatus 하나뿐이다 — 투자자산이 전 구간 0원이면
  // 축도 범례도 토글도 의미가 없어 통째로 내린다. 계획 판정 자체는 이 카드가 말하지 않는다.
  planOutcome: PlanOutcome;
  // 있으면 총 자산액 곡선을 연도별 중앙값으로 그린다. MC가 아직이거나 미지원이면
  // undefined이고, 그때는 기준 수익률 경로로 되돌아간다.
  monteCarlo?: MonteCarloResult;
}

const COMPARE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

// 총 자산액 곡선이 «어느 기준»인지의 문구.
//
// 이 자리는 네 번 바뀌었다. 팬 차트(p10~p90) → 세 선(p10/p50/p90) → 한 선(p10) → 지금.
// 팬 차트를 버린 이유는 축이 P90에 끌려가서였고(39년 뒤 상위 10%는 80억까지 벌어지는데
// 결정론 곡선은 10억 언저리라 주 곡선이 바닥에 눌렸다), 세 선을 한 선으로 줄인 이유는
// 계열이 일곱 개가 되어 점선끼리 겹쳐서였다.
//
// 이번에 바뀐 것은 선의 «개수»가 아니라 **주 곡선의 기준**이다. 진단 카드의
// 「N세 예상자산」이 중앙값이 된 뒤로 이 차트만 결정론 곡선을 그리면 한 화면이 다시 두
// 기준을 말한다. 그래서 주 곡선을 연도별 중앙값으로 바꾸고, 함께 있던 「나쁜 경우」 점선은
// 걷어냈다(사용자 요청).
//
// **이 곡선은 어느 실제 시행의 경로도 아니다.** 각 해의 50% 지점은 서로 다른 시행에서 온다.
// 밝히지 않으면 사용자가 이 선을 "내 자산이 이렇게 흘러간다"로 읽는다.
const MEDIAN_NOTE = '총 자산액 곡선은 시장 변동 시행에서 각 해의 중앙값이며, 한 사람의 실제 경로가 아닙니다.';

// 구성 계열(주식/연금/ISA/현금)은 **기준 수익률 경로의 분해**다. 중앙값 총액 아래에 두면
// 부분의 합이 총액과 맞지 않으므로, 간단히 보기에서는 넷 다 내리고 상세보기에서만 낸다.
// 상세보기에서는 총액도 기준 수익률로 되돌아간다(아래 usesMedian 참조).
const BREAKDOWN_KEYS = ['주식자산', '연금자산', 'ISA자산', '현금'] as const;

// 범례 표기. 아래 <Area>/<Line> 선언의 name/dataKey/stroke/strokeDasharray와 짝을 이룬다 —
// 어긋나면 범례가 차트에 없는 색이나 모양을 말한다.
const ASSET_LEGEND: ChartLegendItem[] = [
  // 라벨은 아래에서 기준(중앙값/기준 수익률)에 따라 덮어쓴다. 여기 값은 자리 표시다.
  { dataKey: '자산총액', label: '총 자산액', color: 'var(--primary)', shape: 'area' },
  { dataKey: '주식자산', label: '주식/ETF 자산', color: 'var(--accent)', shape: 'dashed' },
  { dataKey: '연금자산', label: '연금 자산', color: 'var(--secondary)', shape: 'dashed' },
  { dataKey: 'ISA자산', label: 'ISA 자산', color: 'var(--success)', shape: 'dashed' },
  { dataKey: '현금', label: '현금', color: 'var(--foreground-muted)', shape: 'dashed' },
];

export interface AssetChartData {
  rows: Record<string, number>[];
  /** 총 자산액 곡선이 연도별 중앙값인가. false면 기준 수익률 경로다. */
  usesMedian: boolean;
}

/**
 * 차트가 그릴 행들과 **그 총액이 어느 기준인지**를 함께 만든다.
 *
 * 기준을 한 번만 정하고 전 구간에 같게 적용한다. 해마다 밴드 유무를 보고 고르면 한 곡선
 * 안에서 두 기준이 섞이는데, 그 뒤섞임은 화면 어디에도 드러나지 않는다 — 한 해라도 비면
 * 곡선 전체를 기준 수익률로 되돌리는 편이 정직하다.
 *
 * 구성 계열(주식/연금/ISA/현금)과 비교 시나리오는 언제나 기준 수익률 경로다. 비교 대상
 * 시나리오는 몬테카를로를 돌리지 않으므로 중앙값 자체가 없다.
 */
export function buildAssetChartData(
  yearlyResults: SimulationResult['yearlyResults'],
  compareResults: CompareResultEntry[],
  bandByAge: Map<number, MonteCarloAssetBandYear> | undefined,
): AssetChartData {
  const usesMedian = bandByAge !== undefined
    && bandByAge.size > 0
    && yearlyResults.every((r) => bandByAge.has(r.age));

  const rows = yearlyResults.map((r) => {
    const dataPoint: Record<string, number> = {
      age: r.age,
      자산총액: Math.max(0, Math.round(usesMedian ? bandByAge!.get(r.age)!.p50 : r.totalAssets)),
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

  return { rows, usesMedian };
}

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
  // 전 구간 0원인 축은 정보를 주지 않는다. 고갈시킬 자산이 없는 사용자에게 빈 차트와
  // 죽은 토글을 보여 주느니 「투자자산이 없어 표시할 수 없다」고 말하는 편이 낫다.
  const hasNoInvestableAsset = planOutcome.assetStatus === 'no_investable_asset';

  // 밴드가 «비어 있는» 경우까지 막아야 한다. 워커가 돌려준 payload에 이 필드가 없으면
  // (개발 중 HMR로 워커 청크만 낡는 경우) 가드가 없을 때 `undefined.map`으로 대시보드
  // 전체가 죽는다. 길이를 보고 없으면 기준 수익률 경로로 되돌린다.
  //
  // 상세보기에서는 밴드를 아예 만들지 않는다 — 구성 계열과 총액의 기준을 맞추기 위해서다.
  const bands = monteCarlo?.assetBands;
  const bandByAge = !showBreakdown && bands && bands.length > 0
    ? new Map(bands.map((b) => [b.age, b]))
    : undefined;

  const { rows: assetChartData, usesMedian } = buildAssetChartData(
    yearlyResults,
    compareResults,
    bandByAge,
  );

  // 정상적으로 인출 가능한 해에는 r.spending에 의료비가 이미 합산되어 있다(자산이 고갈된
  // 해에는 인출 가능한 만큼으로 깎여 spending < healthcareSpending이 될 수 있다 —
  // types.ts SimulationYearlyResult.healthcareSpending의 "예외" 참조).
  // 의료비 가정을 켠 시나리오에서만 라벨에 그 사실을 밝힌다 — 밝히지 않으면
  // "생활비를 200만원으로 넣었는데 왜 250만원이지?"가 된다.
  const hasHealthcareCost = yearlyResults.some((r) => r.healthcareSpending > 0);

  // 월 생활비 라벨은 의료비 포함 여부에 따라 달라지고, 비교 시나리오는 개수가 가변이다.
  // 둘 다 아래 시리즈 선언과 같은 규칙을 써야 범례와 그래프가 같은 이야기를 한다.
  // 간단히 보기에서 강제로 숨기는 구성 시리즈는 범례에서도 뺀다. 클릭해도 상위의
  // assetChartHiddenKeys 오버레이가 다시 숨기는 버튼을 노출하면 고장 난 토글처럼 보인다.
  const totalAssetLabel = `총 자산액 (${usesMedian ? '중앙값' : '기준 수익률'})`;
  const visibleAssetLegend = (showBreakdown
    ? ASSET_LEGEND
    : ASSET_LEGEND.filter((item) => !BREAKDOWN_KEYS.includes(item.dataKey as typeof BREAKDOWN_KEYS[number])))
    .map((item) => (item.dataKey === '자산총액' ? { ...item, label: totalAssetLabel } : item));
  const legendItems: ChartLegendItem[] = [
    ...visibleAssetLegend,
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
        {/* 이 자리에 계획 판정 배지(투자자산 소진 / 생활비 부족 / 유지됨)를 함께 두었다가
            걷어냈다. 같은 사실을 화면이 이미 세 번 말하고 있었기 때문이다 — 1페이지의
            계획 진단 줄, 「생활비 재원 구성」 차트의 캡션, 그리고 「계획 상세 수치」의
            부족액 표. 차트 머리에 붙은 배지는 그중 가장 좁은 자리에서 가장 짧게 말해,
            숫자를 더 주지 않으면서 시선만 먼저 가져갔다.

            남긴 것은 이 카드에서만 할 수 있는 조작인 구성 토글뿐이다. */}
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
      <ChartCaption>{caption}</ChartCaption>
      {!hasNoInvestableAsset && (
        <ChartLegend items={legendItems} hiddenKeys={hiddenKeys} onToggle={onLegendClick} />
      )}
      {usesMedian && !hasNoInvestableAsset && (
        <p className="mt-1 text-xs text-foreground-muted">{MEDIAN_NOTE}</p>
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
              <Area
                yAxisId="left"
                name={totalAssetLabel}
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
