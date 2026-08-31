'use client';

import React, { type ReactNode } from 'react';
import { type LegendPayload } from 'recharts';
import { Award, Zap, TrendingUp, AlertTriangle, ChevronDown } from 'lucide-react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../../core/entities/types';
import type { StrategyApplyPreview } from '../../../core/usecases/dashboard/applyStrategyToParams';
import { initialParams } from '../../../infrastructure/storage/localStore';
import { describeSpendingCurve } from '../../../core/usecases/spending/spendingCurve';
import styles from './Dashboard.module.css';
import { formatValue as formatValueForCurrency } from './charts/chartFormatters';
import { AssetGrowthChart } from './charts/AssetGrowthChart';
import { IncomeCompositionChart } from './charts/IncomeCompositionChart';
import { SpendingCompositionChart } from './charts/SpendingCompositionChart';
import { ShortfallSummaryCard } from './kpi/ShortfallSummaryCard';
import { ExpertDetailsPanel } from './expert/ExpertDetailsPanel';
import { RiskAlertCards } from './risk/RiskAlertCards';
import { MonteCarloSection } from './montecarlo/MonteCarloSection';
import { MonteCarloResult } from '../../../core/entities/montecarlo';
import { MonteCarloStatus } from '../../hooks/useMonteCarlo';
import type { AppliedStrategySnapshot } from '../../hooks/useAppliedStrategy';
import { SequenceRiskResult } from '../../../core/usecases/montecarlo/sequenceRisk';
import { ExecutionRoadmap } from './roadmap/ExecutionRoadmap';
import { computeExecutionRoadmap, selectDepletionAge } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeKeyLevers } from '../../../core/usecases/dashboard/computeKeyLevers';
import {
  getPlanConfidenceBand,
  PLAN_CONFIDENCE_BAND_TIER,
} from '../../../core/usecases/dashboard/computePlanConfidence';
import { explainGoalShortfall } from '../../../core/usecases/dashboard/explainGoalShortfall';
import { resolveTerminalAssetDisplay } from '../../../core/usecases/dashboard/resolveTerminalAssetDisplay';
import type { GoalSuccessConditions } from '../../../core/usecases/goals/goalSuccessConditions';
import { describeGoalConflict } from '../../../core/usecases/goals/describeGoalConflict';
import { describeSustainableSpendingLimit } from '../../../core/usecases/dashboard/describeSustainableSpendingLimit';
import { describeSuccessRates } from '../../../core/usecases/montecarlo/describeSuccessRates';
import { resolveSimulationVerdict, type SimulationVerdict } from '../../../core/usecases/montecarlo/resolveSimulationVerdict';
import { describeSustainableSpendingBasis } from '../../../core/usecases/dashboard/describeSustainableSpendingBasis';
import GlassCard from '../../components/GlassCard';
import { retirementGoalDefinition } from '../RetirementGoals/goalCatalog';
import { describeUnscoredGoals } from '../../../core/usecases/goals/goalScoreSupport';
import { KeyLeversCard } from './recommendation/KeyLeversCard';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { compileStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { SentinelApplication } from '../../../core/usecases/strategy/applyAiSentinels';
import { describeSentinelAxes } from './sentinelAxisLabels';
import { LegacySimulationAdapter } from '../../../core/domain/input/LegacySimulationAdapter';
import { LegacyEvaluationEngine } from '../../../core/evaluation/LegacyEvaluationEngine';
import type { CandidateRecommendation } from '../../../core/recommendation/RecommendationEngine';
import type { StrategyOptimizationResult } from '../../../core/strategy/StrategyOptimizer';
import type { StrategyOptimizationStatus } from '../../hooks/useStrategyOptimization';
import { StrategyRecommendationCards } from './recommendation/StrategyRecommendationCards';

interface DashboardSectionProps {
  params: SimulationParams;
  result: SimulationResult;
  compareResults?: { id: string, name: string, result: SimulationResult }[];
  isPro?: boolean;
  // 레거시 추천. 화면에서 추천 카드로 노출하지는 않지만 「무엇부터 바꿔야 하나」의 인출 순서
  // 레버가 여기서 근거를 인용한다(computeKeyLevers).
  recommendation?: StrategyRecommendation;
  // AI 센티널이 자동으로 계산에 넣은 축. 진단 카드가 "무엇이 자동으로 채워졌는지"를 밝히는
  // 데 쓴다 — 밝히지 않으면 사용자가 입력한 적 없는 값이 결과에 들어간 사실이 화면에서
  // 사라진다(sentinelAxisLabels 주석 참고).
  sentinels?: SentinelApplication;
  // 몬테카를로는 워커에서 돌아 결과가 늦게 도착한다. 여기서 훅을 부르지 않고 위에서
  // 내려받는 이유: 이 컴포넌트는 자주 리렌더되는데, 그때마다 워커를 다시 띄우면 스켈레톤이
  // 깜빡인다. 훅은 params가 실제로 바뀌는 곳(page.tsx)에 둔다.
  monteCarlo?: MonteCarloResult;
  monteCarloStatus?: MonteCarloStatus;
  sequenceRisk?: SequenceRiskResult;
  strategyOptimization?: StrategyOptimizationResult;
  strategyOptimizationStatus?: StrategyOptimizationStatus;
  strategyOptimizationError?: string;
  // 추천 카드의 적용 액션. 여기서는 그대로 통과시키기만 한다 — «무엇에» 적용할지는
  // page.tsx가 정한다. 이 컴포넌트가 받는 params는 센티널이 적용된 표시용 값이고,
  // 실제 적용 대상은 사용자가 입력한 activeParams라서 여기서 결정하면 안 된다.
  // 두 콜백의 두 번째 인자는 추천 카드가 「달라지는 점」을 서술한 기준 params다. 카드가
  // 스스로 넘기므로 이 컴포넌트는 그대로 통과시킨다 — 여기서 채우면 카드가 실제로 본 값과
  // 어긋날 수 있다.
  onApplyStrategy?: (
    recommendation: CandidateRecommendation,
    simulatedParams: SimulationParams,
  ) => void;
  previewStrategyApply?: (
    recommendation: CandidateRecommendation,
    simulatedParams: SimulationParams,
  ) => StrategyApplyPreview;
  appliedStrategy?: AppliedStrategySnapshot;
  onUndoStrategy?: () => void;
}

// 결과 화면 오케스트레이터.
//
// **IA는 4단이다: 진단 → 추천 → 실행 → 근거.**
//   ① 현재 계획 진단  — 지금 괜찮은가, 왜 그런가
//   ② NextLife 추천   — 목표에 가장 가까운 전략과 바뀌는 점
//   ③ 실행 시점       — 그래서 지금 무엇을 하면 되는가
//   ④ 계획의 근거     — 위 판정들을 뒷받침하는 자료(접힘)
//
// **③이 접힘 «밖»으로 나온 이유.** 「무엇부터 바꿔야 하나」와 「실행 로드맵」은 사용자가
// 결과 화면을 떠나기 전 마지막으로 묻는 것 —「그래서 나는 지금 무엇을 하면 되지?」— 에
// 답하는 유일한 자리인데, ④ 안에 있어서 접기를 펴야 닿았다. 「근거」는 판정을 뒷받침하는
// 자료이지 «할 일»이 아니다. 두 카드 모두 새 시뮬레이션을 돌리지 않고 이미 계산된 값을
// 문장으로 옮길 뿐이라(computeKeyLevers·computeExecutionRoadmap) 자리를 올려도 비용이 없다.
//
// 예전에는 ④가 "상세 분석"이라는 이름의 <details>였고 그 안에 결과 요약·위험·실행·차트·상세
// 다섯 그룹이 들어 있었다. 그중 「결과 요약」(AiSummaryHero + CoreKpiGrid)은 ①이 이미 말한
// 판정·확률·목표 생활비·기말자산을 다른 이름으로 다시 말했고, 「AI 추천 전략」 체크리스트는
// ②와 다른 축(평생 효용 점수)으로 두 번째 추천을 냈다. 같은 사실은 한 곳에서만 말한다.
export const DashboardSection: React.FC<DashboardSectionProps> = ({
  params: rawParams,
  result,
  compareResults = [],
  isPro = false,
  recommendation,
  sentinels,
  monteCarlo,
  monteCarloStatus = 'idle',
  sequenceRisk,
  strategyOptimization,
  strategyOptimizationStatus = 'idle',
  strategyOptimizationError,
  onApplyStrategy,
  previewStrategyApply,
  appliedStrategy,
  onUndoStrategy,
}) => {
  // 세 차트가 이 상태 하나를 공유한다. 처음부터 숨길 시리즈는 없다 — 예전에는 몬테카를로
  // 상위 10% 선을 꺼 두었지만(축이 그 선에 끌려가 주 곡선이 눌렸다) 그 계열 자체가 사라졌다.
  const [hiddenKeys, setHiddenKeys] = React.useState<Record<string, boolean>>({});
  const [compositionChart, setCompositionChart] = React.useState<'income' | 'spending'>('income');
  // 자산 추이 차트 기본 단순화 모드: 켜지기 전까지는 주식자산/연금자산 breakdown을 숨기고
  // 자산총액/월생활비만 보여준다. 범례 클릭으로 저장된 hiddenKeys는 그대로 두고 덮어씌우기만 한다.
  const [showAssetBreakdown, setShowAssetBreakdown] = React.useState(false);

  const handleLegendClick = (data: LegendPayload) => {
    const dataKey = data.dataKey;
    if (dataKey !== undefined) {
      const key = String(dataKey);
      setHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  // 간단히 보기에서 내리는 구성 계열. AssetGrowthChart의 BREAKDOWN_KEYS와 «같은 목록»이어야
  // 한다 — 범례는 그 목록으로 버튼을 빼고 그림은 이 오버레이로 선을 숨기므로, 어긋나면
  // 눌러도 아무 일도 일어나지 않는 버튼이 생긴다.
  const assetChartHiddenKeys = showAssetBreakdown
    ? hiddenKeys
    : { ...hiddenKeys, 주식자산: true, 연금자산: true, ISA자산: true, 현금: true };

  const params: SimulationParams = React.useMemo(() => ({
    ...rawParams,
    // 폴백은 앱이 새 시나리오에 넣는 값(initialParams)과 같아야 한다. 여기에 리터럴을
    // 적어 두면 같은 "기본 프로필"의 정의가 둘이 되고, 둘이 조용히 어긋난다.
    userProfile: rawParams?.userProfile || initialParams.userProfile,
    assets: rawParams?.assets || [],
    nationalPension: rawParams?.nationalPension || { expectedMonthlyAmount: 0 },
    privatePensions: rawParams?.privatePensions || [],
    otherIncomes: rawParams?.otherIncomes || [],
    inflationRate: rawParams?.inflationRate ?? 2,
    inflationMode: rawParams?.inflationMode || 'real',
    baseExchangeRate: rawParams?.baseExchangeRate ?? 1350,
    displayCurrency: rawParams?.displayCurrency || 'KRW',
    spendingStrategy: rawParams?.spendingStrategy || 'target',
  }), [rawParams]);

  const currency = params.displayCurrency;
  const formatValue = (val: number) => formatValueForCurrency(val, currency);

  // 「생활비 배분」이 목표 생활비를 나이대별로 얼마로 바꿨는지. 곡선이 없으면 빈 배열이라
  // 아래 표시가 통째로 사라진다 — 나열할 구간이 없다는 뜻이지 오류가 아니다.
  const spendingBands = React.useMemo(() => describeSpendingCurve(
    params.spendingCurve,
    params.userProfile.targetMonthlySpending,
    params.userProfile.retirementAge,
    params.userProfile.expectancy,
  ), [params]);

  // 목표 우선순위가 정한 효용 배점을 포함해 legacy 입력을 새 Domain/Input 경계로 변환한다.
  const utilityConfig = React.useMemo(() => compileStrategy(params).utilityConfig, [params]);
  const domainInput = React.useMemo(
    () => LegacySimulationAdapter.fromLegacy(params, utilityConfig),
    [params, utilityConfig]
  );
  const evaluationEngine = React.useMemo(() => new LegacyEvaluationEngine(), []);

  const monteCarloForDisplay = monteCarloStatus === 'done' ? monteCarlo : undefined;
  // 평가는 한 번만 돈다. 예전에는 Before/After 토글 때문에 displayed/baseline 두 벌을
  // 계산했는데, 토글이 사라진 지금 두 호출은 언제나 같은 입력을 받는다.
  const evaluation = React.useMemo(
    () => evaluationEngine.evaluate(
      domainInput.profile,
      domainInput.goals,
      domainInput.strategy,
      result,
      { monteCarlo: monteCarloForDisplay }
    ),
    [domainInput, result, evaluationEngine, monteCarloForDisplay]
  );

  const {
    metrics,
    chartCaptions: captions,
    riskAlerts,
    planAssetStatus,
    planOutcome,
    shortfall: shortfallReport,
    lifetimeSpendingPlan,
    sustainableSpendingAdvice,
    pensionGap,
  } = evaluation;

  // 소득 차트의 국민연금 개시 기준선. 수령액이 0이면 그 해에 아무 일도 일어나지 않으므로
  // 기준선을 그리지 않는다.
  const nationalPensionStartAge =
    (params.nationalPension?.expectedMonthlyAmount ?? 0) > 0
      ? params.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE
      : undefined;

  // 민감도 분석은 예전에 ExpertDetailsPanel 안에서만 계산됐다. 핵심 레버 카드가 같은 값을
  // 인용해야 하므로 여기로 끌어올려 한 번만 계산하고 아래로 내려준다 — 두 곳에서 각자 돌리면
  // 시뮬레이션 7회가 두 배가 되고, 더 나쁘게는 두 카드가 다른 실행 결과를 말할 수 있다.
  const sensitivity = React.useMemo(
    () => evaluationEngine.analyzeSensitivity(params),
    [evaluationEngine, params]
  );
  const keyLevers = React.useMemo(
    () => computeKeyLevers({ sensitivity, pensionGap, shortfall: shortfallReport, recommendation, formatValue }),
    // formatValue는 매 렌더 새 참조지만 currency에만 의존하므로 통화를 의존성으로 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sensitivity, pensionGap, shortfallReport, recommendation, currency]
  );
  // 판정의 단일 출처. 폴백을 다시 쌓지 않는다 — 예전에는 simulationSuccessRate ??
  // goalSuccessProbability 두 단계였고, 이 화면 스스로 spendingSuccessRate로 대체하지 말라고
  // 경고했었다(그 지표는 "고갈 여부를 묻지 않는" 다른 값이라 언제나 목표 성공확률보다 관대해서,
  // 대체하면 목표를 못 지키는 계획이 🟢으로 표시될 수 있다).
  //
  // available이 false면 rate는 NaN이다. **아래에서 rate를 쓰는 모든 자리는 이 verdict.available
  // 분기를 통과한 뒤에만 읽는다** — NaN을 그대로 비교식에 넣으면(getPlanConfidenceBand의 임계
  // 사다리 등) 모든 비교가 false로 떨어져 "판정 못 함"이 조용히 가장 관대한 가지로 빠진다.
  // 측정되지 않았으면 아래에서 '확인 불가'로 내려간다.
  const verdict = React.useMemo(
    () => resolveSimulationVerdict({ monteCarlo: monteCarloForDisplay, params }),
    [monteCarloForDisplay, params]
  );
  const currentGoalProbability = verdict.available ? verdict.goalSuccess.rate : undefined;
  // 임계값은 computePlanConfidence가 소유한다. 같은 화면에 이미 그 밴드로 그린 지표가 있어
  // 별도 임계값을 두면 0.85에서 한쪽은 '안정', 한쪽은 🟡으로 갈린다.
  const diagnosisTier = currentGoalProbability !== undefined
    ? PLAN_CONFIDENCE_BAND_TIER[getPlanConfidenceBand(currentGoalProbability)]
    : undefined;
  const diagnosis = diagnosisTier !== undefined
    ? diagnosisTier === 'green'
      ? { emoji: '🟢', text: '현재 계획으로 안정적인 은퇴가 가능합니다.', tone: 'success' as const }
      : diagnosisTier === 'orange'
        ? { emoji: '🟡', text: '조금 조정하면 안정적인 은퇴가 가능합니다.', tone: 'warning' as const }
        : { emoji: '🔴', text: '목표를 지키려면 현재 계획의 조정이 필요합니다.', tone: 'danger' as const }
    : planOutcome.spendingShortfall || planOutcome.assetStatus === 'depleted'
      ? { emoji: '🔴', text: '기준 시나리오에서 현재 계획의 조정이 필요합니다.', tone: 'danger' as const }
      : planOutcome.investableDepletionAge !== null
        ? { emoji: '🟡', text: '기준 시나리오는 유지되지만 투자자산 소진에 대비해야 합니다.', tone: 'warning' as const }
        : { emoji: '🟢', text: '기준 시나리오에서는 계획한 생활비와 자산이 유지됩니다.', tone: 'success' as const };
  // 확률이 왜 그 값인지. 확률만 보여주면 사용자는 언제나 "자산 부족"으로 읽지만, 인출을
  // 막는 설정(사적연금 최소 인출·자산 하한선) 때문에 자산이 남아도 목표를 못 채우는 계획이
  // 같은 숫자를 받는다. 그 구분은 explainGoalShortfall이 소유한다.
  const goalShortfallExplanation = monteCarlo
    ? explainGoalShortfall({
      goalFailure: monteCarlo.goalFailure,
      trials: monteCarlo.trials,
      params,
      formatValue,
    })
    : undefined;
  const probabilityLabel = currentGoalProbability !== undefined
    ? `${Math.round(currentGoalProbability * 100)}%`
    : monteCarloStatus === 'error' || monteCarloStatus === 'unsupported'
      ? '확인 불가'
      : '계산 중';
  const biggestRisk = riskAlerts[0]?.title
    ?? (result.depletionAge !== null
      ? `${result.depletionAge}세에 투자자산이 소진될 가능성`
      : currentGoalProbability !== undefined && currentGoalProbability < 0.9
        ? '시장 하락 시 생활비 목표를 유지할 여유 부족'
        : '현재 가정에서 발견된 중대한 위험 없음');
  // 「N세 예상자산」이 어느 기준의 값인가. monteCarloForDisplay를 쓰므로 워커가 끝나기 전에는
  // 자동으로 기준 수익률 경로로 되돌아간다.
  const terminalAssetDisplay = resolveTerminalAssetDisplay(metrics.terminalAssets, monteCarloForDisplay);
  const appliedSentinelLabels = describeSentinelAxes(sentinels?.appliedFields ?? []);
  // 충돌이 없으면 undefined다. 그 «하나»로 「그리지 않는다」를 판정한다 — 빈 배열이나 빈
  // 문자열을 따로 검사하기 시작하면 화면과 PDF가 각자의 「비었다」 기준을 갖게 되고, 한쪽만
  // 조용해지는 날 아무도 알아채지 못한다. 문장도 여기서 짓지 않는다(describeGoalConflict).
  const goalConflict = describeGoalConflict(evaluation.goalConflict);

  // 「지속가능 생활비」가 HARD 바닥을 존중해 다시 계산된 계획의 고지. 충돌 고지와 같은
  // 규칙이다 — 판정도 문장도 여기서 짓지 않고, 그릴 것이 없으면 undefined 하나로 말한다.
  // 이 고지가 없으면 3.35억을 남기던 계획과 0원 계획이 «같은 얼굴»로 보인다.
  // 두 성공률의 캡션과 종합 확률 관계 문장. **한 번만 계산해 두 카드에 내려보낸다** —
  // 시장 변동 검증의 두 비율과 부족 요약 카드의 성공률이 같은 판정 기준을 말해야 하는데,
  // 각자 만들면 한쪽만 바뀌는 날 두 카드가 다른 기준을 말한다(민감도를 끌어올린 것과 같은 이유).
  // 문장 자체는 core가 만든다 — PDF가 «같은 문장»을 인쇄해야 하기 때문이다.
  const successRateCopy = React.useMemo(
    () => (monteCarloForDisplay
      ? describeSuccessRates({ monteCarlo: monteCarloForDisplay, params, formatValue })
      : undefined),
    // formatValue는 매 렌더 새 참조지만 통화에만 의존한다(위 keyLevers와 같은 규칙).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monteCarloForDisplay, params, currency],
  );

  const sustainableLimit = describeSustainableSpendingLimit({
    override: result.sustainableSpendingOverride,
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    expectancy: params.userProfile.expectancy,
    formatValue,
  });

  return (
    <div className={styles.container}>
      <DashboardGroup title="현재 계획 진단" description="나는 지금 괜찮은지, 무엇이 가장 취약한지부터 확인하세요.">
        <section className={`${styles.planDiagnosis} ${styles[diagnosis.tone]}`} aria-label="현재 계획 분석">
          <div className={styles.diagnosisHeadline}>
            <span aria-hidden="true">{diagnosis.emoji}</span>
            <h3>{diagnosis.text}</h3>
          </div>
          <div className={styles.diagnosisGrid}>
            <div>
              <span>목표 달성 확률</span>
              <strong>{probabilityLabel}</strong>
              {currentGoalProbability !== undefined && monteCarlo && (
                <small>
                  {monteCarlo.trials.toLocaleString()}회 중{' '}
                  {Math.round(currentGoalProbability * monteCarlo.trials).toLocaleString()}회가 판정 조건 충족
                </small>
              )}
            </div>
            <div>
              <span>가장 큰 위험</span>
              <strong>{biggestRisk}</strong>
            </div>
          </div>
          {currentGoalProbability !== undefined && (
            <p className={styles.simulationDisclaimer}>
              입력한 수익률, 물가, 연금, 수명 및 시장 변동 가정 범위 내의 시뮬레이션 결과이며 실제 미래 결과를 보장하지 않습니다.
            </p>
          )}
          <dl className={styles.currentPlanFacts} aria-label="현재 계획">
            <div><dt>은퇴</dt><dd>{params.userProfile.retirementAge}세</dd></div>
            {/* 「생활비 배분」을 고르면 목표가 나이대별로 달라진다. 이 칸은 **은퇴 직후 구간의
                금액**을 보여준다 — 사용자가 은퇴 목표 단계에서 입력한 바로 그 금액이다.

                예전에는 여기에 전 구간 평균(SimulationMetricsCalculator의 average(goalMonthly))이
                「월 생활비 목표(평균)」이라는 이름으로 서 있었다. 평균이라고 밝혀 두어도, 300만원을
                입력한 사용자가 진단 카드 첫 화면에서 261만원을 보면 「내가 설정한 값이 왜 다르지」로
                읽는다. 평균은 이 카드가 답하는 질문(내 계획이 어떤가)에 필요한 숫자가 아니다.

                평균값 자체는 계산에서 사라지지 않는다 — metrics.targetSpending은 채점·평가가
                계속 쓴다. 여기 KPI 자리에서만 내린다.

                구간 전체는 바로 아래 spending-band-note가 그대로 편다. */}
            <div>
              <dt>{spendingBands.length > 0 ? '은퇴 초기 생활비' : '월 생활비 목표'}</dt>
              <dd>
                {formatValue(spendingBands.length > 0
                  ? spendingBands[0].monthlyAmount
                  : metrics.targetSpending)}
              </dd>
            </div>
            {/* 기준을 라벨에 적는다. 이 카드의 확률과 실패 시행 수는 몬테카를로인데 이 칸만
                결정론 1회 실행이던 때, 같은 계획의 두 숫자가 4배 넘게 벌어졌다(실측 11.44억
                대 2.67억). 어느 기준을 쓸지는 resolveTerminalAssetDisplay가 정한다. */}
            <div>
              <dt>{`${params.userProfile.expectancy}세 예상자산(${
                terminalAssetDisplay.basis === 'monte_carlo_median' ? '중앙값' : '기준 수익률'
              })`}</dt>
              <dd>{formatValue(terminalAssetDisplay.amount)}</dd>
            </div>
          </dl>
          {/* 자산 추이 차트는 흔들리지 않는 경로라 결정론 값에서 끝난다. 밝히지 않으면 KPI와
              차트가 이유 없이 어긋난 채로 남는다. */}
          {terminalAssetDisplay.trials !== null && (
            <p className={styles.planFactNote} data-testid="terminal-asset-basis-note">
              시장 변동을 {terminalAssetDisplay.trials.toLocaleString()}회 반영한 중앙값입니다.
              변동이 없다고 가정한 기준 수익률 경로에서는{' '}
              {formatValue(terminalAssetDisplay.deterministicAmount)}입니다.
            </p>
          )}
          {/* 평균이라고만 하면 "그래서 나는 얼마를 쓰는가"에 답하지 못한다. 구간을 그대로 편다. */}
          {spendingBands.length > 0 && (
            <p className={styles.planFactNote} data-testid="spending-band-note">
              연령대별 배분을 적용해 {spendingBands.map((band) => (
                `${band.fromAge}~${band.toAge ?? params.userProfile.expectancy}세 ${formatValue(band.monthlyAmount)}`
              )).join(' · ')}으로 계산했습니다.
            </p>
          )}
          {monteCarlo && monteCarlo.goalConditions.basis !== 'legacy_plan' && (
            <GoalCoverageNote conditions={monteCarlo.goalConditions} />
          )}
          {verdict.hardGoalSuccess !== null && (
            <HardGoalSuccessNote hardGoalSuccess={verdict.hardGoalSuccess} />
          )}
          {/* **cause로 가르지 않는다.** 목표를 다 달성했는데도 자산은 실제로 고갈된 계획은
              cause가 'none'이면서(확률이 정말 100%다) 할 말이 있다. 예전에 여기서 cause를
              보고 잘랐더니 그 문장이 한 번도 화면에 닿지 못했다. 제목도 여기서 적지 않는다 —
              그 경우에는 「목표를 달성하지 못한 시행의 원인」이 바로 아래 문장을 부정한다.
              「보여줄지」와 「어떤 제목으로」는 문장을 만든 곳이 함께 정한다. */}
          {goalShortfallExplanation && goalShortfallExplanation.label !== undefined && (
            <div className={styles.goalShortfallReason}>
              <span>{goalShortfallExplanation.label}</span>
              <p>{goalShortfallExplanation.headline}</p>
              {/* headline은 지배적인 원인 하나만 말한다. 나머지 원인이 화면 어디에도 남지
                  않으면 사용자는 무엇을 고쳐야 하는지 구성으로 볼 수 없다. */}
              {goalShortfallExplanation.breakdown && (
                <p className={styles.goalShortfallHint}>{goalShortfallExplanation.breakdown}</p>
              )}
              {goalShortfallExplanation.hint && (
                <p className={styles.goalShortfallHint}>{goalShortfallExplanation.hint}</p>
              )}
            </div>
          )}
          {/* 사용자가 입력한 적 없는 값이 결과에 들어갔다면 반드시 밝힌다. 예전에는 추천
              체크리스트의 "이미 반영됨" 블록이 이 역할을 했다. */}
          {appliedSentinelLabels.length > 0 && (
            <p className={styles.goalCoverageNote}>
              미정으로 둔 설정은 계산에 자동으로 반영했습니다 — {appliedSentinelLabels.join(', ')}.
            </p>
          )}
          {currentGoalProbability === undefined && (
            <p className={styles.deterministicNote}>확률 검증 전에는 기준 시나리오의 생존·생활비 부족 여부만 진단합니다.</p>
          )}
        </section>
      </DashboardGroup>

      {/* 「내가 고른 목표들이 서로 맞지 않는다」. 진단 카드 «안»이 아니라 그 아래에 둔다 —
          그 카드는 「내 계획이 어떤가」를 말하는 자리이고 충돌은 다른 층위의 사실이다(스펙).
          그리고 추천보다 «앞»이어야 한다. 무엇이 부딪히는지를 먼저 알아야 추천이 왜 그런
          모양인지 이해된다. */}
      {goalConflict && (
        <GlassCard className={styles.goalConflictNotice} role="note" aria-labelledby="goal-conflict-title">
          <strong id="goal-conflict-title">{goalConflict.title}</strong>
          <p>{goalConflict.lead}</p>
          <ul>
            {goalConflict.shortfalls.map((shortfall) => <li key={shortfall}>{shortfall}</li>)}
          </ul>
        </GlassCard>
      )}

      <DashboardGroup title="NextLife 추천" description="목표에 가장 가까운 최종 전략과 현재 계획에서 바뀌는 점만 비교합니다.">
        <StrategyRecommendationCards
          recommendations={strategyOptimization?.recommendations?.recommendations}
          primary={strategyOptimization?.recommendations?.primary}
          // 진단 카드가 방금 보여준 그 숫자를 그대로 넘긴다. 카드가 스스로 다시 계산하면
          // 같은 화면의 위아래가 다른 확률로 비교하게 된다.
          currentGoalProbability={currentGoalProbability}
          status={strategyOptimizationStatus}
          errorMessage={strategyOptimizationError}
          unsupportedHardGoals={strategyOptimization?.debug?.unsupportedHardGoals}
          outcome={strategyOptimization?.outcome}
          // 「적용하면 달라지는 수치」의 «전». 화면이 들고 있는 result가 아니라 옵티마이저가
          // 같은 경로에서 낸 현상 유지 후보의 요약이다(baselineOutcome 주석).
          baselineOutcome={strategyOptimization?.baselineOutcome}
          sustainableSpendingAdvice={sustainableSpendingAdvice}
          params={params}
          formatValue={formatValue}
          onApplyStrategy={onApplyStrategy}
          previewStrategyApply={previewStrategyApply}
          appliedStrategy={appliedStrategy}
          onUndoStrategy={onUndoStrategy}
        />
      </DashboardGroup>

        <DashboardGroup title="실행 시점" description="무엇부터 손대야 하는지와, 나이별로 무슨 일이 일어나는지 확인하세요.">
          {/* 인출 전략보다 위에 둔다. 이유는 computeKeyLevers 주석 참고 — 매도 순서·인출
              개시 나이는 이 계획에서 다섯 번째로 중요한 레버인데, 예전에는 그것이 실행
              계획의 첫 카드였다. */}
          <KeyLeversCard levers={keyLevers} />

          {/* 실행 로드맵은 **현재 계획 기준**이다. computeExecutionRoadmap에 추천안을
              넘기지 않으므로 getIdentityPlan(현재 설정)으로 폴백한다 — 이 화면의 다른
              모든 숫자와 같은 계획을 그려야 마일스톤과 고갈 시점이 어긋나지 않는다
              (selectDepletionAge 주석 참고). */}
          <ExecutionRoadmap
            roadmap={computeExecutionRoadmap(
              params,
              undefined,
              selectDepletionAge(undefined, result),
              planAssetStatus
            )}
            isRecommendedPlan={false}
          />
        </DashboardGroup>

      {/* ④ 근거. 위 판정들을 뒷받침하는 자료만 담는다 — 판정을 다시 내리지 않는다.
          한 번 열면 끝까지 보이도록 안쪽에 접힘을 두지 않는다(예전에는 여기서 두 번 더
          열어야 세금 표에 닿았다). */}
      <details className={styles.detailedAnalysis}>
        <summary>
          <span className={styles.detailedAnalysisHeading}>
            {/* 부제에 아래 그룹 제목을 그대로 나열하지 않는다 — 같은 문자열이 summary와
                본문에 두 번 생겨 "어느 쪽이 그 섹션인가"가 모호해진다. */}
            <strong>계획의 근거</strong>
            <small>위 판정을 뒷받침하는 차트와 확률 검증, 세부 수치를 모두 확인할 수 있습니다</small>
          </span>
          <span className={styles.detailedAnalysisToggle} aria-hidden="true">
            <span className={styles.detailedAnalysisOpenLabel}>자세히 보기</span>
            <span className={styles.detailedAnalysisCloseLabel}>접기</span>
            <ChevronDown size={16} strokeWidth={2} />
          </span>
        </summary>
        <div className={styles.detailedAnalysisContent}>
          <DashboardGroup title="자산 흐름" description="전체 자산 추이와 연령별 소득·지출 구성을 살펴보세요.">
            <AssetGrowthChart
              params={params}
              result={result}
              compareResults={compareResults}
              hiddenKeys={assetChartHiddenKeys}
              onLegendClick={handleLegendClick}
              caption={captions.assetGrowth}
              showBreakdown={showAssetBreakdown}
              onToggleBreakdown={() => setShowAssetBreakdown((v) => !v)}
              planOutcome={planOutcome}
              monteCarlo={monteCarloForDisplay}
            />
            <div className={styles.chartTabs} role="tablist" aria-label="현금흐름 차트 선택">
              <button type="button" role="tab" aria-selected={compositionChart === 'income'} onClick={() => setCompositionChart('income')}>소득 구성</button>
              <button type="button" role="tab" aria-selected={compositionChart === 'spending'} onClick={() => setCompositionChart('spending')}>지출 구성</button>
            </div>
            <div role="tabpanel">
              {compositionChart === 'income' ? (
                <IncomeCompositionChart
                  params={params}
                  result={result}
                  hiddenKeys={hiddenKeys}
                  onLegendClick={handleLegendClick}
                  caption={captions.incomeComposition}
                  nationalPensionStartAge={nationalPensionStartAge}
                />
              ) : (
                <SpendingCompositionChart
                  params={params}
                  result={result}
                  hiddenKeys={hiddenKeys}
                  onLegendClick={handleLegendClick}
                  caption={captions.spendingComposition}
                />
              )}
            </div>
          </DashboardGroup>

          <DashboardGroup title="시장 변동 검증" description="계획이 실패할 수 있는 조건과 시장 변동의 영향을 함께 봅니다.">
            <RiskAlertCards alerts={riskAlerts} />
            <MonteCarloSection
              status={monteCarloStatus}
              monteCarlo={monteCarlo}
              successRateCopy={successRateCopy}
              sequenceRisk={sequenceRisk}
              formatValue={formatValue}
              isPro={isPro}
            />
          </DashboardGroup>

          <DashboardGroup title="계획 상세 수치" description="생활비 부족액과 세금·건강보험료, 가정이 바뀔 때의 민감도를 확인하세요.">
            <div className={styles.statusList} aria-label="현재 계획 상태">
              {lifetimeSpendingPlan && (
                <StatusNotice tone="success" icon={<Award size={19} aria-hidden="true" />} title="평생 소비 최적화 결과">
                  {lifetimeSpendingPlan.assetFloor !== undefined
                    ? <>{params.userProfile.expectancy}세에 <strong>{formatValue(lifetimeSpendingPlan.assetFloor)}</strong>을 남기면서, </>
                    : <>고갈 없이 유지하면서, </>}
                  {lifetimeSpendingPlan.segments.length > 0
                    ? (
                      <>
                        연령대별로 다음 금액까지 쓸 수 있습니다.
                        <ul className={styles.spendingPlanList}>
                          {lifetimeSpendingPlan.segments.map((s) => (
                            <li key={s.fromAge}>
                              {s.fromAge}~{s.toAge ?? params.userProfile.expectancy}세{' '}
                              <strong>{formatValue(s.monthlyAmount)}</strong>
                            </li>
                          ))}
                        </ul>
                      </>
                    )
                    : <>월 <strong>{formatValue(lifetimeSpendingPlan.baseMonthly)}</strong>까지 쓸 수 있습니다.</>}
                  {/*
                    결정론 한 경로의 결과이므로 확률을 함께 보여준다. 계산이 끝났을 때만 —
                    없는 숫자를 기다리게 하지 않는다.

                    **successRate가 아니라 spendingSuccessRate를 쓴다.** 이 배너의 주장은 "이만큼 쓸 수
                    있다"이므로, 물어야 할 확률은 "그 금액을 실제로 다 쓰는 비율"이다. 자산 고갈
                    여부(successRate)는 여기서 거의 정보가 없다 — 목표 상속자산을 정하면 엔진이
                    그 선 아래로 인출을 막아 고갈이 구조적으로 일어나지 않는다. 하니스 실측:
                    성공률 100%인 계획의 완전소비율이 43%였다. 그 계획에 "성공확률 100%"라고
                    말하는 것은 사용자를 오도한다.
                  */}
                  {monteCarloStatus === 'done' && monteCarlo && (
                    <> 다만 시장 변동을 반영하면 이 금액을 한 해도 줄이지 않고 유지할 확률은{' '}
                      <strong>{Math.round(monteCarlo.spendingSuccessRate * 100)}%</strong>입니다.</>
                  )}
                </StatusNotice>
              )}
              {lifetimeSpendingPlan?.belowMinimum && (
                <StatusNotice
                  tone="danger" icon={<AlertTriangle size={19} aria-hidden="true" />}
                  title="역산된 생활비가 최소 기준에 못 미칩니다"
                >
                  가장 적은 구간이 월 <strong>{formatValue(lifetimeSpendingPlan.belowMinimum.lowestMonthly)}</strong>으로,
                  설정한 최소 생활비({formatValue(lifetimeSpendingPlan.belowMinimum.minMonthlySpending)})보다 낮습니다.
                  목표 상속자산을 줄이거나 은퇴 시점을 늦추는 방향을 검토해 보세요.
                </StatusNotice>
              )}
              {/* 「지속가능 생활비」가 HARD 바닥을 존중해 다시 계산된 계획.
                  바로 위 「평생 소비 최적화 결과」가 말한 금액의 «성격»을 밝히는 자리라
                  그 배너 바로 아래에 둔다 — 금액과 그 금액이 무엇인지가 떨어져 있으면
                  사용자는 앞의 숫자만 읽고 권장액으로 가져간다.
                  예전 이 자리에는 「바닥에 닿지 못한다」 배너가 있었다. 엔진이 이제 바닥을
                  지급하므로 그 상태는 생기지 않는다(computeSustainableSpendingAdvice 주석). */}
              {sustainableLimit && (
                <StatusNotice
                  tone="danger" icon={<AlertTriangle size={19} aria-hidden="true" />}
                  title={sustainableLimit.title}
                >
                  {/* 문장마다 span으로 감싼다. StatusNotice가 children을 <p> 하나로 감싸므로
                      <p>를 겹치면 잘못된 HTML이 되고, 한 덩어리로 이으면 어느 문장이 떴는지
                      테스트가 «문장 단위»로 고정하지 못한다. */}
                  <span>{sustainableLimit.reason}</span>{' '}
                  <span>{sustainableLimit.limit}</span>
                  {sustainableLimit.terminalAssets && <>{' '}<span>{sustainableLimit.terminalAssets}</span></>}
                  {sustainableLimit.depletionRisk && <>{' '}<span>{sustainableLimit.depletionRisk}</span></>}
                </StatusNotice>
              )}
              {sustainableSpendingAdvice?.kind === 'can_spend_more' && (
                <StatusNotice tone="info" icon={<TrendingUp size={19} aria-hidden="true" />} title="계산상 최대 지속 가능 생활비">
                  월 <strong>{formatValue(sustainableSpendingAdvice.sustainableMonthly)}</strong>.{' '}
                  {/* **기준을 반드시 붙인다.** 같은 화면이 「목표 달성 확률 71%」를 말하고 있어,
                      기준 없이 금액만 놓으면 사용자는 그 확률을 이 금액에도 적용해 읽는다.
                      문장은 core가 만든다 — PDF가 같은 문장을 인쇄해야 한다. */}
                  <span className={styles.statusBasisNote} data-testid="sustainable-basis-note">
                    {describeSustainableSpendingBasis(params.userProfile.expectancy)}
                  </span>
                </StatusNotice>
              )}
              {sustainableSpendingAdvice?.kind === 'overspending' && (
                <StatusNotice tone="danger" icon={<AlertTriangle size={19} aria-hidden="true" />} title="현재 목표 생활비는 지속하기 어렵습니다">
                  지속 가능한 한도는 월 <strong>{formatValue(sustainableSpendingAdvice.sustainableMonthly)}</strong>으로,
                  현재 목표보다 월 {formatValue(sustainableSpendingAdvice.difference)} 낮습니다.
                  {planAssetStatus === 'no_investable_asset'
                    ? ' 생활비를 줄이거나, 은퇴 시점을 늦추거나, 추가 저축·투자로 자산을 마련해야 합니다.'
                    : ' 생활비·은퇴 시점·인출 전략을 조정해 보세요.'}{' '}
                  <span className={styles.statusBasisNote} data-testid="sustainable-basis-note">
                    {describeSustainableSpendingBasis(params.userProfile.expectancy)}
                  </span>
                </StatusNotice>
              )}
              {params.spendingStrategy === 'dividend_only' && (
                <StatusNotice tone="info" icon={<Zap size={19} aria-hidden="true" />} title="배당금 100% 소비 모드 적용 중">
                  은퇴 후 배당금과 연금만 소비하며 원금은 매도하지 않습니다.
                </StatusNotice>
              )}
            </div>

            <ShortfallSummaryCard
              report={shortfallReport}
              formatValue={formatValue}
              expectancy={params.userProfile.expectancy}
              spendingSuccessRate={monteCarloForDisplay?.spendingSuccessRate}
              spendingSuccessCaption={successRateCopy?.spendingCaption}
            />

            <ExpertDetailsPanel
              result={result}
              params={params}
              isPro={isPro}
              formatValue={formatValue}
              sensitivity={sensitivity}
            />
          </DashboardGroup>

        </div>
      </details>
    </div>
  );
};

// 이 확률이 **어떤 목표를 판정한 것인지** 밝힌다. 밝히지 않으면 "판정하지 않음"이
// "판정해서 통과함"으로 읽힌다 — 세금 최소화를 골라 둔 사용자는 그 목표까지 포함된 확률로
// 이 숫자를 읽는데, 시행 하나로 세금 목표의 성공/실패를 물을 방법은 없다.
function GoalCoverageNote({ conditions }: { conditions: GoalSuccessConditions }) {
  const unmeasured = conditions.unmeasuredGoals
    .map((type) => retirementGoalDefinition(type).label)
    .join(', ');
  // 「확률에 반영되지 않았다」와 「점수 산정 대상이 아니다」는 다른 사실이다. 앞의 것은 이
  // 몬테카를로가 판정하지 못한 목표이고(연금·세금 목표가 그렇다), 뒤의 것은 결과에서 점수를
  // 유도하는 «산식 자체»가 없어 평가가 상수 0을 돌려주는 목표다. 앞의 문장만 두면 그 0이
  // 「판정했는데 실패했다」로 읽힌다. 문장은 core가 소유한다 — PDF가 같은 문장을 인쇄한다.
  const unscored = describeUnscoredGoals(conditions.unmeasuredGoals);

  return (
    <p className={styles.goalCoverageNote}>
      {conditions.basis === 'plan_defaults'
        ? '선택한 목표는 시장 변동 시행으로 판정할 수 없어, 계획의 기본 조건(목표 생활비 유지·자산 고갈 없음)으로 계산한 확률입니다.'
        : '선택한 목표 중 시행으로 판정할 수 있는 조건만 반영한 확률입니다.'}
      {unmeasured && ` 이 확률에 반영되지 않은 목표: ${unmeasured}.`}
      {unscored && ` ${unscored}`}
    </p>
  );
}

// 확정 HARD 목표 중 «시행 하나로 판정할 수 있는» 것만 센 성공률. GoalCoverageNote와 같은
// 자리·같은 어투를 쓴다 — 「반영되지 않았다」를 밝히는 방식을 화면 안에서 두 벌로 만들지
// 않기 위해서다.
//
// **unjudged를 비율과 떼어 놓지 않는다.** known-issues #1은 주거 안정을 HARD로 고정해도
// 계산은 정확했지만 화면이 그 조건이 지켜진 것처럼 보여준 결함이었다. HARD 성공률에 판정하지
// 못한 목표가 섞여 있는데 그 사실을 밝히지 않으면 같은 결함을 지표 하나로 반복한다.
function HardGoalSuccessNote({ hardGoalSuccess }: { hardGoalSuccess: NonNullable<SimulationVerdict['hardGoalSuccess']> }) {
  const total = hardGoalSuccess.judged.length + hardGoalSuccess.unjudged.length;
  const rateText = `HARD 목표 판정 확률 ${Math.round(hardGoalSuccess.rate * 100)}%`;

  if (hardGoalSuccess.unjudged.length === 0) {
    return (
      <p className={styles.goalCoverageNote}>
        {rateText} (HARD 목표 {total}개 모두 이 확률의 판정 기준에 포함됩니다).
      </p>
    );
  }

  const unjudged = hardGoalSuccess.unjudged
    .map((type) => retirementGoalDefinition(type).label)
    .join(', ');
  return (
    <p className={styles.goalCoverageNote}>
      {rateText} — HARD 목표 {total}개 중 {hardGoalSuccess.judged.length}개만 이 판정 기준에 포함됩니다.
      시행으로 판정할 수 없어 반영되지 않은 HARD 목표: {unjudged}.
    </p>
  );
}

function DashboardGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className={styles.dashboardGroup} aria-labelledby={`dashboard-${title}`}>
      <header className={styles.groupHeader}>
        <h2 id={`dashboard-${title}`} className={styles.groupTitle}>{title}</h2>
        <p className={styles.groupDescription}>{description}</p>
      </header>
      <div className={styles.groupContent}>{children}</div>
    </section>
  );
}

function StatusNotice({ tone, icon, title, children }: {
  tone: 'success' | 'danger' | 'info';
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.statusNotice} ${styles[tone]}`}>
      <span className={styles.statusIcon}>{icon}</span>
      <div>
        <p className={styles.statusTitle}>{title}</p>
        <p className={styles.statusText}>{children}</p>
      </div>
    </div>
  );
}
export default DashboardSection;
