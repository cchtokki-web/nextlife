import { RiskAlert } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { SensitivityScenario } from '../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { PlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { ShortfallReport } from '../../../core/usecases/dashboard/computeShortfallSummary';
import { KeyLever } from '../../../core/usecases/dashboard/computeKeyLevers';
import {
  PLAN_CONFIDENCE_BAND_LABEL,
  PLAN_CONFIDENCE_BAND_TIER,
  PlanConfidence,
  PlanConfidenceBandKey,
} from '../../../core/usecases/dashboard/computePlanConfidence';
import { NationalPensionExplanation } from '../../../core/usecases/pension/explainNationalPension';
import { SimulationParams } from '../../../core/entities/types';
import { formatManwon } from '../../../core/usecases/utility/utilityAnalysis';
import { MonteCarloResult } from '../../../core/entities/montecarlo';
import { GoalSuccessConditions } from '../../../core/usecases/goals/goalSuccessConditions';
import { SequenceRiskResult } from '../../../core/usecases/montecarlo/sequenceRisk';
import { OptimizationOutcome } from '../../../core/strategy/StrategyOptimizer';
import { CandidateRecommendation } from '../../../core/recommendation/RecommendationEngine';
import { RetirementGoalType } from '../../../core/entities/retirementGoal';
import { RETIREMENT_GOAL_CATALOG } from '../RetirementGoals/goalCatalog';
import { describeStrategyChanges } from '../../../core/usecases/dashboard/describeStrategyChanges';
import type { StrategyOptimizationStatus } from '../../hooks/useStrategyOptimization';

export function formatCurrencyUnit(currency: 'KRW' | 'USD'): '원' | '$' {
  return currency === 'KRW' ? '원' : '$';
}

// PDF는 화면과 별개로 완전히 독립된 정적 HTML 문자열을 html2canvas로 캡처하는 구조라(page.tsx의
// handleDownload), 화면 컴포넌트를 재사용할 수 없다 — 동일한 usecase 데이터를 받아 PDF 전용
// 인라인 스타일 HTML 문자열로 변환하는 순수 함수만 여기 둔다. 기존 handleDownload가 이미 자산/
// 연금 이름 등을 이스케이프 없이 직접 보간하는 것과 동일한 관례를 따른다(신규 도입 아님).

// "현재 계획을 유지하면" 블록. 화면의 ShortfallSummaryCard와 같은 값·같은 각주를 쓴다 —
// 리포트만 가정을 빼면 사용자가 확정된 목표 금액으로 읽는다.
//
// 목표 기준과 계획 기준을 나눠 싣는 이유는 카드 쪽 주석과 같다: 「평생 소비 최적화」에서
// 계획 기준 부족만 보여주면 "부족 생활비 월 0원"이 되어, 목표보다 한참 덜 쓰는 계획이
// 문제 없는 계획으로 읽힌다.
export function renderShortfallSummarySection(
  report: ShortfallReport | null,
  formatValue: (val: number) => string,
  // 화면(ShortfallSummaryCard)과 같은 두 문장을 내기 위한 값. 없으면 확률 문장을 생략한다.
  context?: { expectancy: number; spendingSuccessRate?: number }
): string {
  if (!report || (!report.goal && !report.plan)) return '';
  const { goal, plan, goalMonthlySpending, sustainableMonthlySpending } = report;

  const cell = (label: string, value: string, danger = true) => `
    <div style="flex: 1;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">${label}</p>
      <p style="margin: 2px 0 0; font-size: 15px; font-weight: 700; color: ${danger ? '#dc2626' : '#0f172a'};">${value}</p>
    </div>
  `;

  const goalHtml = goal
    ? `
      <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #334155;">목표 생활비 기준</p>
      <div style="display: flex; gap: 14px;">
        ${cell('목표 생활비', `월 ${formatValue(goalMonthlySpending)}`, false)}
        ${cell('지속가능 생활비', `월 ${formatValue(sustainableMonthlySpending)}`, false)}
        ${cell('목표 대비 평균 부족액', `월 ${formatValue(goal.averageMonthlyShortfall)}`)}
      </div>
      <p style="margin: 6px 0 0; font-size: 10.5px; color: #64748b;">
        ${goal.firstShortfallAge}세 ~ ${goal.lastShortfallAge}세 ${goal.shortfallYears}년간 · 목표를 그대로 채우려면 약 ${formatValue(goal.totalShortfallInTodayValue)}이 더 필요합니다.
      </p>
    `
    : '';

  const planHtml = plan
    ? `
      <p style="margin: ${goal ? '12px' : '0'} 0 6px; font-size: 12px; font-weight: 700; color: #dc2626;">계획한 생활비조차 채우지 못하는 구간</p>
      <div style="display: flex; gap: 14px;">
        ${cell('계획 기준 평균 부족액', `월 ${formatValue(plan.averageMonthlyShortfall)}`)}
        ${cell('부족 기간', `${plan.shortfallYears}년 (${plan.firstShortfallAge}세 ~ ${plan.lastShortfallAge}세)`)}
        ${cell('추가로 필요한 자산', `약 ${formatValue(plan.totalShortfallInTodayValue)}`)}
      </div>
    `
    // **결정론 결과와 확률 결과를 한 문장에 섞지 않는다.** 예전 문구("월 223만원 소비 시에는
    // 자산이 계획대로 유지됩니다")는 기준 수익률이 실현될 때에만 참인데 조건이 어디에도 없었다.
    // 화면(ShortfallSummaryCard)과 같은 두 문장을 낸다 — 두 문서가 갈라지면 안 된다.
    : sustainableMonthlySpending < goalMonthlySpending
      ? `<p style="margin: 12px 0 0; font-size: 12px; color: #0f172a;">기준 수익률이 실현된다는 가정에서는 월 ${formatValue(sustainableMonthlySpending)} 소비 시${context ? ` ${context.expectancy}세까지` : ''} 계획이 유지됩니다.</p>`
        + (context?.spendingSuccessRate !== undefined
          ? `<p style="margin: 3px 0 0; font-size: 11.5px; color: #475569;">시장 변동성을 고려한 생활 유지 성공률: <strong>${Math.round(context.spendingSuccessRate * 100)}%</strong></p>`
          : '')
      : '';

  return `
    <div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 12px 14px; margin-top: 12px;">
      <p style="margin: 0 0 8px; font-size: 12.5px; font-weight: 700; color: #0f172a;">현재 계획을 유지하면</p>
      ${goalHtml}
      ${planHtml}
      <p style="margin: 8px 0 0; font-size: 10px; color: #64748b; line-height: 1.5;">
        * 추가로 필요한 자산은 부족분을 그대로 채우는 데 드는 금액입니다. 수익률이 물가상승률과 같다고 볼 때의
        현재 구매력 기준이며, 투자 수익을 가정하면 더 적은 금액으로도 가능합니다.
      </p>
    </div>
  `;
}

// 「무엇부터 바꿔야 하나」. 화면(KeyLeversCard)과 같은 데이터·같은 순서를 쓴다.
//
// 인출 전략 체크리스트보다 앞에 놓아야 하는 이유는 computeKeyLevers 주석에 있다 — 체크리스트가
// 탐색하는 축(매도 순서·인출 개시 나이)은 대부분의 계획에서 다섯 번째로 중요한 레버다.
export function renderKeyLeversSection(levers: KeyLever[]): string {
  if (levers.length === 0) return '';

  const rows = levers
    .map(
      (lever, index) => `
      <li style="margin: 0 0 6px; font-size: 11.5px; color: #0f172a;">
        <strong>${index + 1}. ${lever.title}</strong>
        <span style="display: block; margin-top: 2px; font-size: 11px; color: #475569;">${lever.detail}</span>
      </li>
    `
    )
    .join('');

  return `
    <div style="border: 1px solid #e2e8f0; background-color: #f8fafc; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;">
      <p style="margin: 0 0 2px; font-size: 12.5px; font-weight: 700; color: #0f172a;">무엇부터 바꿔야 하나</p>
      <p style="margin: 0 0 8px; font-size: 10.5px; color: #64748b;">이미 계산된 결과에서 영향이 큰 순서로 정리했습니다. 아래로 갈수록 효과가 작습니다.</p>
      <ol style="margin: 0; padding-left: 16px;">${rows}</ol>
    </div>
  `;
}

// 1페이지 최상단 판정 블록: 기준 시나리오 / 시장 변동성 반영 / 판정.
//
// **왜 이 셋을 갈라 놓는가.**
//
// 예전 1페이지는 "은퇴 준비도 64점(주의)"와 "자산 고갈: 기대수명까지 고갈 없음"을 나란히
// 놓았고, "1,000회 중 37%만 90세까지 자산이 남음"은 여섯 페이지 뒤에 있었다. 앞의 두
// 문장은 **결정론 기준 시나리오에서만** 참인데 그 조건이 어디에도 적혀 있지 않아,
// 사용자는 "조금 부족하지만 괜찮다"로 읽었다. 실제 의미는 "10번 중 6번은 실패한다"였다.
//
// 계산을 바꾸는 것이 아니라, 두 세계를 각각 이름 붙여 보여주고 판정을 하나로 낸다.
export function renderPlanVerdictSection(input: {
  expectancy: number;
  // describeDepletionAge가 만든 문장(화면과 같은 함수를 쓴다).
  deterministicDepletionText: string;
  endingAssets: number;
  confidence: PlanConfidence;
  monteCarlo?: MonteCarloResult;
  formatValue: (val: number) => string;
}): string {
  const { expectancy, deterministicDepletionText, endingAssets, confidence, monteCarlo, formatValue } = input;

  const block = (title: string, body: string, accent: string) => `
    <div style="border-left: 4px solid ${accent}; padding: 8px 0 8px 12px; margin-bottom: 12px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.02em;">${title}</p>
      ${body}
    </div>
  `;

  const deterministicHtml = block(
    '기준 시나리오 · 수익률이 가정대로 실현될 때',
    `<p style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">${deterministicDepletionText}
       <span style="font-size: 12px; font-weight: 500; color: #475569;">· ${expectancy}세 잔여자산 ${formatValue(endingAssets)}</span></p>`,
    '#3b82f6'
  );

  // MC가 준비되지 않았으면 **조용히 생략하지 않는다.** 예전에는 워커가 늦으면 시장 변동성
  // 페이지 자체가 사라져, 리포트가 결정론 결과만 담은 채로 완결된 문서처럼 보였다.
  const probabilisticHtml = monteCarlo === undefined || confidence.basis !== 'probabilistic'
    ? block(
        '시장 변동성 반영',
        `<p style="margin: 0; font-size: 12.5px; color: #b45309;">아직 계산되지 않았습니다. 잠시 후 리포트를 다시 내려받으면 확률 판정이 포함됩니다.</p>`,
        '#f59e0b'
      )
    : block(
        `시장 변동성 반영 · ${monteCarlo.trials.toLocaleString()}회 시뮬레이션`,
        // **목표 달성 확률 하나만 싣는다.** 화면의 진단 카드와 같은 분업이다 — 이 블록은
        // 판정을 내리고, 그 확률을 이루는 두 성분(생활 유지·자산 보존)과 잔여자산 분포는
        // 「시장 변동 검증」 섹션이 소유한다. 예전에는 세 확률과 분위수 두 개를 여기서 먼저
        // 인쇄하고 뒤 페이지에서 같은 숫자를 다시 인쇄했다.
        `<p style="margin: 0; font-size: 14px; font-weight: 700; color: ${verdictAccent(confidence)};">
           목표 달성 확률 ${Math.round((confidence.rates?.goalSuccessProbability ?? confidence.rates?.spendingSuccessRate ?? 0) * 100)}%
         </p>
         ${goalCoverageNote(monteCarlo.goalConditions)}`,
        verdictAccent(confidence)
      );

  const verdictHtml = block(
    '판정',
    `<p style="margin: 0; font-size: 14px; font-weight: 700; color: ${verdictAccent(confidence)};">
       ${verdictText(confidence)}
     </p>
     <p style="margin: 3px 0 0; font-size: 11.5px; color: #475569;">
       은퇴 준비도 ${confidence.score}점${
         confidence.basis === 'probabilistic'
           ? ` (${confidence.band ? PLAN_CONFIDENCE_BAND_LABEL[confidence.band] : ''}) · 기준 시나리오만 보면 ${confidence.deterministicScore}점`
           : ' · 시장 변동성 미반영'
       }
     </p>`,
    verdictAccent(confidence)
  );

  return `
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px 8px; margin-bottom: 18px;">
      ${deterministicHtml}
      ${probabilisticHtml}
      ${verdictHtml}
    </div>
  `;
}

// 이 확률이 **어떤 목표를 판정한 것인지** 밝힌다(화면의 GoalCoverageNote와 같은 문장).
// 밝히지 않으면 "판정하지 않음"이 "판정해서 통과함"으로 읽힌다 — 세금 최소화를 골라 둔
// 사용자는 그 목표까지 포함된 확률로 이 숫자를 읽는데, 시행 하나로 세금 목표의 성공/실패를
// 물을 방법은 없다. 리포트는 화면보다 오래 남고 그대로 인용되므로 더 중요하다.
function goalCoverageNote(conditions: GoalSuccessConditions): string {
  if (conditions.basis === 'legacy_plan') return '';

  const unmeasured = conditions.unmeasuredGoals.map(goalLabel).join(', ');
  const base = conditions.basis === 'plan_defaults'
    ? '선택한 목표는 시장 변동 시행으로 판정할 수 없어, 계획의 기본 조건(목표 생활비 유지·자산 고갈 없음)으로 계산한 확률입니다.'
    : '선택한 목표 중 시행으로 판정할 수 있는 조건만 반영한 확률입니다.';

  return `<p style="margin: 3px 0 0; font-size: 11px; color: #475569;">${base}${
    unmeasured ? ` 이 확률에 반영되지 않은 목표: ${unmeasured}.` : ''
  }</p>`;
}

// 색은 밴드→티어 매핑 한 곳에서만 나온다(화면의 진단 카드와 같은 표). 여기서 다시
// switch로 색을 정하면 임계를 바꿀 때 PDF만 옛 색으로 남는다.
const TIER_COLOR = { green: '#059669', orange: '#d97706', red: '#dc2626' } as const;

function verdictAccent(confidence: PlanConfidence): string {
  if (confidence.basis !== 'probabilistic' || confidence.band === undefined) return '#64748b';
  return TIER_COLOR[PLAN_CONFIDENCE_BAND_TIER[confidence.band]];
}

const BAND_VERDICT_TEXT: Record<PlanConfidenceBandKey, string> = {
  very_stable: '현재 계획을 유지해도 좋습니다',
  stable: '대체로 안정적입니다',
  moderate: '유지되지만 여유가 크지는 않습니다',
  caution: '점검이 필요합니다',
  risky: '은퇴계획 조정을 권합니다',
  very_risky: '은퇴계획을 다시 세워야 합니다',
};

function verdictText(confidence: PlanConfidence): string {
  if (confidence.basis !== 'probabilistic' || confidence.band === undefined) {
    return '확률 판정 보류 — 기준 시나리오 결과만 반영되었습니다';
  }
  return BAND_VERDICT_TEXT[confidence.band];
}

// 국민연금 설정액 → 실질 수령액 내역표.
//
// 리포트에는 "예상 월 수령액 2,000,000원(60세부터 수령)"이라 적혀 있는데 표에는 135만원이
// 찍혔다. 계산은 정확했지만 그 사이의 두 단계(조기수령 감액, 연금소득세)가 어디에도 없어
// 사용자가 계산 오류로 판단할 수밖에 없었다.
export function renderNationalPensionSection(
  explanation: NationalPensionExplanation | null,
  formatValue: (val: number) => string
): string {
  if (!explanation) return '';

  const rowsHtml = explanation.steps
    .map((step) => {
      const sign = step.isTotal || step.amount >= 0 ? '' : '−';
      const amountText = `${sign}${formatValue(Math.abs(step.amount))}`;
      const weight = step.isTotal ? '700' : '400';
      const color = step.isTotal ? '#0f172a' : step.amount < 0 ? '#dc2626' : '#475569';
      const borderTop = step.isTotal ? 'border-top: 1px solid #cbd5e1;' : '';
      return `
        <tr>
          <td style="padding: 5px 0; font-size: 11.5px; color: ${color}; font-weight: ${weight}; ${borderTop}">${step.label}</td>
          <td style="padding: 5px 0; font-size: 11.5px; text-align: right; color: ${color}; font-weight: ${weight}; white-space: nowrap; ${borderTop}">월 ${amountText}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <table style="width: 100%; border-collapse: collapse; margin: 6px 0 4px;">
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="margin: 0; font-size: 10px; color: #64748b; line-height: 1.5;">
      * 표의 국민연금 금액은 이 실질 수령액입니다. ${explanation.inflationNote}
      건강보험료는 여기서 차감하지 않고 별도로 부과됩니다.
    </p>
  `;
}

export function renderRiskAlertsSection(alerts: RiskAlert[]): string {
  if (alerts.length === 0) return '';
  const itemsHtml = alerts
    .map(
      (alert) => `
        <div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;">
          <p style="margin: 0; font-size: 12px; font-weight: 700; color: #ef4444;">⚠ ${alert.title}</p>
          <p style="margin: 3px 0 0; font-size: 11px; color: #7f1d1d;">${alert.message}</p>
        </div>
      `
    )
    .join('');
  return `
    <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">⚠ 리스크 알림</h3>
    ${itemsHtml}
  `;
}

// 「NextLife 추천」. 화면의 StrategyRecommendationCards와 같은 데이터·같은 문구를 쓴다
// (달라지는 점은 describeStrategyChanges가 소유한다).
//
// **예전의 「🤖 AI 추천 전략」 체크리스트를 대체한다.** 그쪽은 평생 효용 점수로 항목을
// 정렬해 보여줬는데, 효용은 후보를 서로 비교하기 위한 내부 척도라 사용자가 "+5점"의 크기를
// 가늠할 기준이 없었다. 그리고 화면은 이미 목표 달성 확률로 말하는 다른 추천을 내고 있어,
// 같은 계획의 두 문서가 서로 다른 축으로 서로 다른 전략을 권했다.
//
// **검증되지 않은 상태를 조용히 생략하지 않는다.** 워커가 끝나기 전에 리포트를 내려받으면
// 추천 자리가 통째로 비는데, 그러면 "추천할 것이 없는 계획"으로 읽힌다.
export function renderStrategyRecommendationSection(input: {
  recommendations?: readonly CandidateRecommendation[];
  status: StrategyOptimizationStatus;
  currentGoalProbability?: number;
  unsupportedHardGoals?: readonly RetirementGoalType[];
  outcome?: OptimizationOutcome;
  params: SimulationParams;
  formatValue: (value: number) => string;
}): string {
  const {
    recommendations, status, currentGoalProbability, unsupportedHardGoals, outcome, params, formatValue,
  } = input;

  const notice = (text: string) =>
    `<p style="margin: 0; font-size: 12px; color: #b45309;">${text}</p>`;

  if (status !== 'done') {
    return notice(
      status === 'unsupported'
        ? '이 브라우저에서는 백그라운드 검증을 실행할 수 없어 전략 추천을 계산하지 못했습니다.'
        : status === 'error'
          ? '전략 추천을 검증하는 중 오류가 발생했습니다. 나머지 분석은 정상입니다.'
          : '아직 계산되지 않았습니다. 잠시 후 리포트를 다시 내려받으면 추천 전략이 포함됩니다.'
    );
  }

  const finalRecommendations = recommendations ?? [];
  if (finalRecommendations.length === 0) {
    return notice(describeEmptyOutcome(outcome));
  }

  const recommended = finalRecommendations.find((item) => item.persona === 'BALANCED')
    ?? finalRecommendations[0];

  // 검증할 수 없었던 HARD 목표를 밝힌다. 밝히지 않으면 "확인하지 않음"이 "확인해서 통과함"으로
  // 읽힌다 — 리포트는 화면보다 오래 남고 그대로 인용되므로 더 중요하다.
  const unsupportedHtml = unsupportedHardGoals && unsupportedHardGoals.length > 0
    ? `<p style="margin: 0 0 10px; font-size: 11px; color: #b45309; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px;">
         <strong>다음 필수(HARD) 목표는 현재 검증할 수 없습니다:</strong> ${unsupportedHardGoals.map(goalLabel).join(', ')}.
         아래 추천은 이 목표를 만족하는지 확인하지 않은 결과입니다.
       </p>`
    : '';

  const comparisonHtml = `
    <div style="display: flex; align-items: center; gap: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px;">
      <div style="flex: 1;">
        <p style="margin: 0; font-size: 11px; color: #64748b;">현재 계획</p>
        <p style="margin: 2px 0 0; font-size: 18px; font-weight: 700; color: #0f172a;">${
          currentGoalProbability === undefined ? '계산 중' : `${Math.round(currentGoalProbability * 100)}%`
        }</p>
      </div>
      <span style="font-size: 18px; color: #94a3b8;">&rarr;</span>
      <div style="flex: 1; text-align: right;">
        <p style="margin: 0; font-size: 11px; color: #64748b;">추천 전략 적용</p>
        <p style="margin: 2px 0 0; font-size: 18px; font-weight: 700; color: #059669;">${
          Math.round(recommended.candidate.monteCarlo.goalSuccessProbability * 100)
        }%</p>
      </div>
    </div>
  `;

  const cardsHtml = finalRecommendations
    .map((recommendation) => {
      const candidate = recommendation.candidate;
      const isRecommended = recommendation === recommended;
      const changes = describeStrategyChanges(params, candidate, formatValue);
      const changesHtml = changes.length > 0
        ? `<table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
             <tbody>${changes
               .map((change) => `
                 <tr>
                   <td style="padding: 3px 0; font-size: 10.5px; color: #64748b; white-space: nowrap;">${change.label}</td>
                   <td style="padding: 3px 0 3px 8px; font-size: 10.5px; color: #0f172a; text-align: right;">
                     <span style="color: #94a3b8; text-decoration: line-through;">${change.before}</span>
                     &rarr; <strong>${change.after}</strong>
                   </td>
                 </tr>
               `)
               .join('')}</tbody>
           </table>`
        : '<p style="margin: 4px 0 0; font-size: 10.5px; color: #64748b;">핵심 설정은 유지하고 시장 변동 안정성만 재검증한 전략입니다.</p>';

      return `
        <div style="flex: 1; border: ${isRecommended ? '2px solid #3b82f6' : '1px solid #e2e8f0'}; border-radius: 10px; padding: 12px 14px; box-sizing: border-box;">
          <p style="margin: 0; font-size: 13px; font-weight: 700; color: #0f172a;">
            ${recommendation.label}${isRecommended ? ' <span style="font-size: 10px; color: #3b82f6;">&#9733; 추천</span>' : ''}
          </p>
          <p style="margin: 3px 0 8px; font-size: 10px; color: #64748b; line-height: 1.45;">${recommendation.reason}</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              <tr>
                <td style="padding: 2px 0; font-size: 11px; color: #64748b;">목표 달성 확률</td>
                <td style="padding: 2px 0; font-size: 12px; font-weight: 700; color: #0f172a; text-align: right;">${Math.round(candidate.monteCarlo.goalSuccessProbability * 100)}%</td>
              </tr>
              <tr>
                <td style="padding: 2px 0; font-size: 11px; color: #64748b;">생활비</td>
                <td style="padding: 2px 0; font-size: 12px; font-weight: 700; color: #0f172a; text-align: right;">월 ${formatValue(candidate.candidate.strategy.targetMonthlySpending)}</td>
              </tr>
              <tr>
                <td style="padding: 2px 0; font-size: 11px; color: #64748b;">예상 잔여자산(중앙값)</td>
                <td style="padding: 2px 0; font-size: 12px; font-weight: 700; color: #0f172a; text-align: right;">${formatValue(candidate.monteCarlo.terminalAssetMedian)}</td>
              </tr>
            </tbody>
          </table>
          <p style="margin: 10px 0 0; font-size: 11px; font-weight: 700; color: #334155; border-top: 1px solid #e2e8f0; padding-top: 8px;">현재 계획에서 달라지는 점</p>
          ${changesHtml}
        </div>
      `;
    })
    .join('');

  return `
    ${unsupportedHtml}
    ${comparisonHtml}
    <div style="display: flex; gap: 10px; align-items: stretch;">${cardsHtml}</div>
    <p style="margin: 10px 0 0; font-size: 10px; color: #94a3b8;">
      ※ 위 추천은 시뮬레이션 결과이며 실제 설정에 자동 반영되지 않습니다. 적용하려면 설정을 직접 변경하세요.
    </p>
  `;
}

function goalLabel(type: RetirementGoalType): string {
  return RETIREMENT_GOAL_CATALOG.find((goal) => goal.type === type)?.label ?? type;
}

const HARD_CONSTRAINT_LABELS: Record<string, string> = {
  HARD_RETIREMENT_AGE: '희망 은퇴 나이',
  HARD_SPENDING_SHORTFALL: '목표 생활비 유지',
  HARD_ASSET_SURVIVAL: '자산 고갈 방지',
  HARD_MINIMUM_ENDING_ASSETS: '최소 기말자산',
  HARD_UNSPECIFIED: '사유가 기록되지 않은 필수 조건',
};

// 결과가 없는 네 가지 원인을 구분한다. 화면(EmptyOutcomeCard)과 같은 이유다 — 하나로 묶으면
// 엔진이 전부 예외로 죽은 경우에도 "당신의 목표가 불가능하다"는 뜻으로 읽힌다.
function describeEmptyOutcome(outcome?: OptimizationOutcome): string {
  if (outcome?.kind === 'no_candidate_generated') {
    return '입력만으로는 비교할 전략을 만들지 못했습니다. 자산과 연금 정보가 입력되어 있는지 확인해 주세요.';
  }
  if (outcome?.kind === 'no_persona_matched') {
    return `전략 ${outcome.validatedCount}개를 검증했지만 안정형·균형형·여유형 중 어느 특성에도 해당하지 않아 추천을 만들지 못했습니다.`;
  }
  if (outcome?.kind === 'no_candidate_survived') {
    const blocked = outcome.blockedBy.map((code) => HARD_CONSTRAINT_LABELS[code] ?? code).join(', ');
    const base = outcome.hardConstraintRejectedCount > 0
      ? `선택한 필수(HARD) 목표를 동시에 만족하는 전략을 찾지 못했습니다${blocked ? ` — 후보를 막은 조건: ${blocked}` : ''}. 해당 목표를 선택 목표(SOFT)로 바꾸거나 목표치를 조정하면 후보를 찾을 수 있습니다.`
      : '';
    const failed = outcome.failedCount > 0
      ? `${base ? ' ' : ''}또한 전략 ${outcome.failedCount}개는 계산 중 오류로 평가하지 못했습니다.${outcome.firstFailureReason ? ` (원인: ${outcome.firstFailureReason})` : ''}`
      : '';
    return `${base}${failed}` || '현재 목표 조건을 만족하는 추천 후보가 없습니다.';
  }
  return '현재 목표 조건을 만족하는 추천 후보가 없습니다.';
}

export function renderExecutionRoadmapSection(roadmap: ExecutionRoadmap): string {
  const eventsHtml = roadmap.events
    .map((event) => {
      const hasWarning = event.items.some((item) => item.severity === 'warning');
      const itemsHtml = event.items
        .map(
          (item) => `
            <div style="display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 8px; row-gap: 3px; align-items: start; margin-bottom: 8px;">
              <strong style="font-size: 12px; line-height: 1.5; color: ${item.severity === 'warning' ? '#EF4444' : '#0f172a'}; white-space: nowrap;">${item.title}</strong>
              <span style="font-size: 11px; line-height: 1.55; color: #64748b; min-width: 0;">${item.description}</span>
              ${item.changedFromAge === undefined ? '' : `<span style="grid-column: 1 / span 2; justify-self: start; display: inline-block; font-size: 10.5px; line-height: 1.4; font-weight: 700; color: #6366f1; border: 1px solid #c7d2fe; border-radius: 999px; padding: 2px 7px; box-sizing: border-box; white-space: nowrap;">현재 ${item.changedFromAge}세 → 추천 ${event.age}세</span>`}
            </div>
          `
        )
        .join('');
      return `
        <div style="display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start;">
          <div style="width: 52px; flex-shrink: 0; padding-top: 1px; font-size: 13px; line-height: 1.5; font-weight: 700; color: ${hasWarning ? '#EF4444' : '#3b82f6'};">${event.age}세</div>
          <div style="flex-grow: 1;">${itemsHtml}</div>
        </div>
      `;
    })
    .join('');
  return `
    ${eventsHtml}
    <div style="display: flex; gap: 10px; margin-top: 4px;">
      <div style="width: 50px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #94a3b8;">${roadmap.endAge}세</div>
      <div style="flex-grow: 1; font-size: 12px; color: #94a3b8;">${roadmap.endLabel}</div>
    </div>
  `;
}

// 민감도 분석 표.
//
// 예전에는 "자산 고갈 나이" 한 열뿐이었다. 여유 있는 계획에서는 6행이 전부 "평생 유지"로
// 찍혀 표 전체가 아무 정보도 주지 않았다(실제 리포트가 그랬다). 기말자산 열을 함께 실어
// 고갈 여부와 무관하게 시나리오가 구분되게 한다 — 화면의 SensitivityAnalysisSection과
// 같은 판단이다.
//
// 투자자산이 없는 계획에서는 그 기말자산마저 전부 0원이라 6행이 글자 하나까지 같아진다.
// 화면(SensitivityAnalysisSection)과 같은 규칙으로, baseline과 결과가 완전히 동일한 행은
// 접고 몇 개를 접었는지 밝힌다 — 두 문서가 서로 다른 표를 보여주면 안 된다.
export function renderSensitivityTableSection(
  scenarios: SensitivityScenario[],
  baseline?: {
    depletionAge: number | null;
    unmetSpendingYears: number;
    planAssetStatus: PlanAssetStatus;
    // 6개 시나리오가 공통으로 고정한 월 생활비. 화면(SensitivityAnalysisSection)과 같은 이유로
    // 반드시 밝힌다 — 「평생 소비 최적화」 계획에서는 이 값이 사용자가 입력한 목표와 다르다.
    frozenMonthlySpending?: number;
  }
): string {
  if (scenarios.length === 0) return '';

  const noInvestableAsset = baseline?.planAssetStatus === 'no_investable_asset';
  const frozenNoteHtml = baseline?.frozenMonthlySpending === undefined
    ? ''
    : `<p style="margin: 0 0 6px; font-size: 10.5px; color: #64748b;">6개 시나리오 모두 <strong>월 생활비 ${formatManwon(baseline.frozenMonthlySpending)}을 고정</strong>한 채 가정 하나만 바꾼 결과입니다.</p>`;
  const visibleScenarios = noInvestableAsset
    ? scenarios.filter(
        (s) => !(s.endingAssetsDelta === 0
          && s.depletionAge === baseline.depletionAge
          && s.unmetSpendingYears === baseline.unmetSpendingYears)
      )
    : scenarios;
  const hiddenCount = scenarios.length - visibleScenarios.length;
  const noteHtml = noInvestableAsset
    ? `<p style="margin: 6px 0 0; font-size: 10.5px; color: #64748b;">투자자산이 없어 수익률·물가 가정을 바꿔도 기말자산은 0원으로 동일합니다.${
        hiddenCount > 0 ? ` 결과가 동일한 ${hiddenCount}개 가정은 생략했습니다.` : ''
      }</p>`
    : '';

  const rowsHtml = visibleScenarios
    .map((s) => {
      const depletionText = s.depletionAge === null ? '평생 유지' : `${s.depletionAge}세`;
      const deltaColor = s.endingAssetsDelta < 0 ? '#dc2626' : '#059669';
      const deltaText = s.endingAssetsDelta === 0
        ? ''
        : ` <span style="color: ${deltaColor};">(${s.endingAssetsDelta > 0 ? '+' : ''}${formatManwon(s.endingAssetsDelta)})</span>`;
      const unmetText = s.unmetSpendingYears > 0
        ? `<div style="margin-top: 3px; color: #dc2626; font-size: 10px; line-height: 1.35;">생활비 부족 ${s.unmetSpendingYears}년</div>`
        : '';
      return `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; vertical-align: middle;">${s.label}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; text-align: right; vertical-align: middle;"><div style="white-space: nowrap;">${formatManwon(s.endingAssets)}${deltaText}</div>${unmetText}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; text-align: right; vertical-align: middle; white-space: nowrap;">${depletionText}</td>
        </tr>
      `;
    })
    .join('');
  return `
    ${frozenNoteHtml}
    <table style="width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 8px;">
      <colgroup>
        <col style="width: 28%;" />
        <col style="width: 50%;" />
        <col style="width: 22%;" />
      </colgroup>
      <thead>
        <tr>
          <th style="border: 1px solid #cbd5e1; padding: 7px 9px; line-height: 1.4; text-align: left; vertical-align: middle; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">시나리오</th>
          <th style="border: 1px solid #cbd5e1; padding: 7px 9px; line-height: 1.4; text-align: right; vertical-align: middle; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">기말 잔여자산</th>
          <th style="border: 1px solid #cbd5e1; padding: 7px 9px; line-height: 1.4; text-align: right; vertical-align: middle; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155; white-space: nowrap;">자산 고갈 나이</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${noteHtml}
  `;
}

// 몬테카를로 + 시퀀스 리스크 섹션.
//
// 화면은 recharts로 팬 차트를 그리지만 PDF에는 recharts가 없다(전부 표/CSS 막대로 그린다 —
// 이 파일의 다른 렌더러와 같은 관례). 분위수 표와 경우별 비교 표로 같은 정보를 전달한다.
//
// 데이터가 없으면 빈 문자열을 반환한다. 워커가 아직 끝나지 않았거나 실패한 상태에서
// 리포트 전체가 막히면 안 된다 — 개별 실패를 격리하는 computeSensitivityAnalysis와 같은 원칙이다.
export function renderMonteCarloSection(
  monteCarlo: MonteCarloResult | undefined,
  sequenceRisk: SequenceRiskResult | undefined
): string {
  if (!monteCarlo) return '';

  const assetPercent = Math.round(monteCarlo.successRate * 100);
  const spendingPercent = Math.round(monteCarlo.spendingSuccessRate * 100);

  const depletionText = monteCarlo.depletion.count > 0
    ? `<p style="margin: 6px 0 0; font-size: 11px; color: #dc2626;">자산이 먼저 바닥난 경우가 ${monteCarlo.depletion.count.toLocaleString()}회 있었고, 가장 이른 시점은 ${monteCarlo.depletion.earliestAge}세였습니다.</p>`
    : '';

  const sequenceRows = sequenceRisk
    ? sequenceRisk.cases
        .map((c) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px;">${c.label}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${formatManwon(c.endingAssets)}${
              c.depletionAge !== null ? ` <span style="color: #dc2626;">(${c.depletionAge}세 고갈)</span>` : ''
            }</td>
          </tr>
        `)
        .join('')
    : '';

  const sequenceSection = sequenceRisk
    ? `
      <h3 style="margin: 16px 0 6px; font-size: 14px; font-weight: 700; color: #0f172a;">같은 평균, 다른 순서</h3>
      <p style="margin: 0; font-size: 11.5px; color: #475569;">
        좋은 해가 먼저 오느냐 나쁜 해가 먼저 오느냐만으로 기대수명 시점 자산이
        <strong>${formatManwon(sequenceRisk.orderingSpread)}</strong> 갈립니다.
        아래 경우들은 <strong>연평균 수익률이 완전히 같습니다</strong> — 다른 것은 순서뿐입니다.
        <strong>은퇴 직후 5~10년의 수익률이 특히 중요합니다.</strong> 평균이 같더라도 은퇴 초기에 큰 하락이 오면
        생활비를 마련하려고 자산을 싼값에 팔게 되고, 그렇게 줄어든 원금은 이후 시장이 회복해도 함께 회복되지 않습니다.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
        <thead>
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">수익률 순서</th>
            <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">기말 잔여자산</th>
          </tr>
        </thead>
        <tbody>${sequenceRows}</tbody>
      </table>
    `
    : '';

  // **1페이지의 목표 달성 확률을 다시 인쇄하지 않는다.** 여기서 말하는 두 확률은 그 판정을
  // 이루는 성분이고 정의가 서로 다르다(화면의 MonteCarloSection과 같은 분업).
  return `
    <p style="margin: 0; font-size: 11.5px; color: #475569;">
      1페이지 판정의 목표 달성 확률은 아래 가정으로 계산했습니다. 수익률이 해마다 오르내리는 상황을
      ${monteCarlo.trials.toLocaleString()}회 시뮬레이션한 결과이며, 그 확률을 이루는 두 성분은 다음과 같습니다.
      <strong style="font-size: 14px; color: #0f172a;">생활 유지 성공률 ${spendingPercent}%</strong>
      — 계획 생활비(월 ${formatManwon(monteCarlo.plannedMonthlySpending)})를 한 해도 줄이지 않은 경우입니다.
      <strong>자산 보존 성공률 ${assetPercent}%</strong> — ${monteCarlo.successAge}세까지 자산이 남은 경우입니다.
      두 확률은 서로 다른 실패를 셉니다: 연금이 생활비를 덮으면 자산이 바닥나도 생활은 유지됩니다.
    </p>
    <p style="margin: 4px 0 0; font-size: 10px; color: #64748b;">
      계산 가정: 연 변동성 ${monteCarlo.annualStdDev ?? 15}%p · 정규분포 · 모든 위험자산이 같은 시장 충격을 공유 · 고정 시드 ${monteCarlo.seed}
    </p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <thead>
        <tr>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">기대수명 시점 잔여자산</th>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">하위 10%</th>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">중앙값</th>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">상위 10%</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; color: #64748b;">시뮬레이션 분포</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${formatManwon(monteCarlo.endingAssets.p10)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right; font-weight: 700;">${formatManwon(monteCarlo.endingAssets.p50)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${formatManwon(monteCarlo.endingAssets.p90)}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 6px 0 0; font-size: 11px; color: #64748b;">
      변동 없음 가정: ${formatManwon(monteCarlo.deterministicEndingAssets)} — 수익률이 매년 흔들리면
      같은 평균 수익률이라도 결과 중앙값은 이보다 낮아집니다.
    </p>
    ${depletionText}
    ${sequenceSection}
  `;
}
