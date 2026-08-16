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
  // 이제 이 차트가 여기서 읽는 것은 assetStatus 하나뿐이다 — 투자자산이 전 구간 0원이면
  // 축도 범례도 토글도 의미가 없어 통째로 내린다. 계획 판정 자체는 이 카드가 말하지 않는다.
  planOutcome: PlanOutcome;
  // 있으면 P10~P90 밴드를 겹쳐 그린다. MC가 아직이거나 미지원이면 undefined.
  monteCarlo?: MonteCarloResult;
}

const COMPARE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

// 몬테카를로 하방 시리즈. **하위 10% 한 선만 그린다.**
//
// 이 자리는 세 번 바뀌었다. 처음에는 p10~p90을 채운 팬 차트였고, 그 다음이 p10/p50/p90
// 세 선이었다. 팬 차트를 버린 이유는 축이 P90에 끌려가서였다 — 39년 뒤 상위 10%는 80억까지
// 벌어지는데 결정론 곡선은 10억 언저리라, 정작 봐야 할 주 곡선이 바닥에 눌렸다.
//
// 세 선에서 한 선으로 줄인 이유는 다르다. 계열이 일곱 개가 되어 점선 다섯(ISA자산·현금·
// 백분위 세 선)이 서로 겹쳤고,
// 그중 상위 10%는 위 축 문제 때문에 애초에 기본으로 꺼 둔 «죽은 범례»였다(게다가 ISA 자산과
// 색·모양이 완전히 같아 구분되지도 않았다).
//
// **남긴 것이 하방인 이유**: 은퇴 계획에서 사용자가 봐야 할 것은 상방이 아니고, "목표 달성
// 확률 82%"라는 숫자가 왜 나오는지는 이 선이 언제 0원에 닿는지를 보는 것이 가장 빠르다.
// 별도 Monte Carlo 섹션의 분위수 표는 Pro 게이팅이라(MonteCarloSection의 isPro 분기),
// 무료 사용자에게는 이 선이 유일한 하방 시각 정보이기도 하다.
//
// **이 선은 어느 실제 시행의 경로도 아니다.** 각 해의 10% 지점은 서로 다른 시행에서 온다.
// 그래서 아래 범례 밑에 그 사실과 "주 곡선은 변동 없음 가정"임을 함께 밝힌다 — 둘을
// 밝히지 않으면 사용자가 두 곡선 사이 간격을 오차범위로 읽는데, 결정론 곡선은 중앙값보다
// 높으므로 그 간격은 실제 하방폭을 «과소»평가한다.
const DOWNSIDE_SERIES = {
  dataKey: '하위10%',
  label: '나쁜 경우 (하위 10%)',
  color: 'var(--danger)',
} as const;

// 범례 아래에 붙는 고정 문구. ChartCaption(core의 generateChartCaptions)이 아니라 여기에
// 두는 이유는 그 생성기가 MonteCarloResult를 받지 않기 때문이다 — 캡션으로 옮기려면
// usecase 시그니처까지 바꿔야 한다.
const DOWNSIDE_NOTE = '「나쁜 경우」는 시장 변동 시행에서 각 해의 나쁜 쪽 10% 지점이며, 한 사람의 실제 경로가 아닙니다. 총 자산액 곡선은 수익률이 매년 흔들리지 않는다고 가정한 값이라 실제 중앙값보다 높습니다.';

// 범례 표기. 아래 <Area>/<Line> 선언의 name/dataKey/stroke/strokeDasharray와 짝을 이룬다 —
// 어긋나면 범례가 차트에 없는 색이나 모양을 말한다.
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
  // 전 구간 0원인 축은 정보를 주지 않는다. 고갈시킬 자산이 없는 사용자에게 빈 차트와
  // 죽은 토글을 보여 주느니 「투자자산이 없어 표시할 수 없다」고 말하는 편이 낫다.
  const hasNoInvestableAsset = planOutcome.assetStatus === 'no_investable_asset';

  // 하방 선은 «간단히 보기»에서만 그린다. 구성 상세(주식/연금/ISA/현금)를 펼친 상태에
  // 한 선을 더 얹으면 시리즈가 일곱 개가 되어 어느 것도 읽히지 않는다.
  //
  // 밴드가 «비어 있는» 경우까지 막아야 한다. 워커가 돌려준 payload에 이 필드가 없으면
  // (개발 중 HMR로 워커 청크만 낡는 경우) 가드가 없을 때 `undefined.map`으로 대시보드
  // 전체가 죽는데, `?? []`만 두면 반대쪽으로 조용히 실패한다 — `new Map([])`은 truthy라
  // 범례 버튼과 DOWNSIDE_NOTE 문단은 그려지고 정작 선만 없는, 「설명은 있는데 그림이 없는」
  // 화면이 된다. 무료 사용자에게는 이 선이 유일한 하방 신호라 더 그렇다(p10~p90 표는
  // Pro 전용). 그래서 길이를 보고, 없으면 관련 UI를 통째로 내린다.
  const downside = monteCarlo?.assetDownside;
  const bandByAge = !showBreakdown && downside && downside.length > 0
    ? new Map(downside.map((b) => [b.age, b]))
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
      dataPoint[DOWNSIDE_SERIES.dataKey] = Math.max(0, Math.round(band.p10));
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
  // 간단히 보기에서 강제로 숨기는 두 구성 시리즈는 범례에서도 뺀다. 클릭해도 상위의
  // assetChartHiddenKeys 오버레이가 다시 숨기는 버튼을 노출하면 고장 난 토글처럼 보인다.
  const visibleAssetLegend = showBreakdown
    ? ASSET_LEGEND
    : ASSET_LEGEND.filter((item) => item.dataKey !== '주식자산' && item.dataKey !== '연금자산');
  const legendItems: ChartLegendItem[] = [
    ...visibleAssetLegend,
    // 하방 선도 범례 버튼으로 낸다. 끄면 recharts가 축 도메인에서도 빼므로 축이 다시 맞춰진다.
    ...(bandByAge ? [{ ...DOWNSIDE_SERIES, shape: 'dashed' as const }] : []),
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
      {bandByAge && !hasNoInvestableAsset && (
        <p className="mt-1 text-xs text-foreground-muted">{DOWNSIDE_NOTE}</p>
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
              {/* 하방 선을 먼저 그려 결정론 곡선 뒤에 놓는다. 범례 버튼과 1:1로 대응하고
                  (hiddenKeys[dataKey]), 끄면 recharts가 축 도메인에서도 빼므로 축이 곧바로
                  자산총액 기준으로 다시 맞춰진다. */}
              {bandByAge && (
                <Line
                  yAxisId="left"
                  name={DOWNSIDE_SERIES.label}
                  type="monotone"
                  dataKey={DOWNSIDE_SERIES.dataKey}
                  stroke={DOWNSIDE_SERIES.color}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  hide={!!hiddenKeys[DOWNSIDE_SERIES.dataKey]}
                />
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
