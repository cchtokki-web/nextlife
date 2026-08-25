import { RiskAlert } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { describeMonteCarloAssumptions } from '../../../core/usecases/montecarlo/describeAssumptions';
import { describeSuccessRates } from '../../../core/usecases/montecarlo/describeSuccessRates';
import { describeSustainableSpendingBasis } from '../../../core/usecases/dashboard/describeSustainableSpendingBasis';
import { ExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { describeYieldAxisAnchors, SensitivityScenario } from '../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { PlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { ShortfallReport } from '../../../core/usecases/dashboard/computeShortfallSummary';
import { KeyLever } from '../../../core/usecases/dashboard/computeKeyLevers';
import { SustainableSpendingAdvice } from '../../../core/usecases/dashboard/computeSustainableSpendingAdvice';
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
import { RETIREMENT_GOAL_CONSTRAINT_LABELS } from '../../../core/entities/retirementGoal';
import type { GoalConflictVerdict } from '../../../core/evaluation/EvaluationEngine';
import { describeGoalConflict } from '../../../core/usecases/goals/describeGoalConflict';
import {
  describeSustainableSpendingLimit,
  type SustainableSpendingLimitInput,
} from '../../../core/usecases/dashboard/describeSustainableSpendingLimit';
import { hardConstraintLabel, RETIREMENT_GOAL_CATALOG } from '../RetirementGoals/goalCatalog';
import { describeStrategyChanges } from '../../../core/usecases/dashboard/describeStrategyChanges';
import { explainGoalShortfall } from '../../../core/usecases/dashboard/explainGoalShortfall';
import type { StrategyOptimizationStatus } from '../../hooks/useStrategyOptimization';
import { resolveTerminalAssetDisplay } from '../../../core/usecases/dashboard/resolveTerminalAssetDisplay';

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
  const terminalAssetDisplay = resolveTerminalAssetDisplay(endingAssets, monteCarlo);
  const simulationSuccessRate = monteCarlo?.simulationSuccessRate
    ?? monteCarlo?.goalSuccessProbability
    ?? confidence.rates?.goalSuccessProbability
    ?? confidence.rates?.spendingSuccessRate
    ?? 0;

  const block = (title: string, body: string, accent: string) => `
    <div style="border-left: 4px solid ${accent}; padding: 8px 0 8px 12px; margin-bottom: 12px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.02em;">${title}</p>
      ${body}
    </div>
  `;

  const deterministicHtml = block(
    '기준 시나리오 · 수익률이 가정대로 실현될 때',
    `<p style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">${deterministicDepletionText}
       <span style="font-size: 12px; font-weight: 500; color: #475569;">· ${expectancy}세 예상자산(기준 수익률) ${formatValue(terminalAssetDisplay.deterministicAmount)}</span></p>`,
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
        // 화면 진단 카드와 같은 대표값(p50)과 목표 달성 확률만 싣는다. 확률을 이루는 두 성분
        // (생활 유지·자산 보존)과 전체 잔여자산 분포는 「시장 변동 검증」 섹션이 소유한다.
        `<p style="margin: 0; font-size: 14px; font-weight: 700; color: ${verdictAccent(confidence)};">
           시뮬레이션 성공률 ${Math.round(simulationSuccessRate * 100)}%
         </p><p style="margin: 4px 0 0; font-size: 12px; font-weight: 700; color: #0f172a;">
           ${monteCarlo.trials.toLocaleString()}회 중 ${Math.round(simulationSuccessRate * monteCarlo.trials).toLocaleString()}회 성공<br>
           ${expectancy}세 예상자산(중앙값) ${formatValue(terminalAssetDisplay.amount)}
         </p>
         <p style="margin: 4px 0 0; font-size: 10px; color: #64748b;">입력한 수익률, 물가, 연금, 수명 및 시장 변동 가정 범위 내의 시뮬레이션 결과이며 실제 미래 결과를 보장하지 않습니다.</p>
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
      ${terminalAssetDisplay.basis === 'monte_carlo_median' ? `${probabilisticHtml}${deterministicHtml}` : `${deterministicHtml}${probabilisticHtml}`}
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

/**
 * 「내가 고른 목표들이 서로 맞지 않는다」. 「현재 계획 진단」 아래, 「NextLife 추천」 위에
 * 놓인다(buildReportHtml) — 무엇이 부딪히는지를 먼저 알아야 추천의 모양이 설명된다.
 *
 * **문장을 여기서 짓지 않는다.** describeGoalConflict가 화면과 이 리포트에 같은 말을 준다.
 * 문구를 두 벌로 두면 반드시 갈라지고, 리포트는 화면보다 오래 남아 그대로 인용된다.
 *
 * 판정을 «필수» 인자로 받는다. 선택 인자로 두면 호출자가 빠뜨렸을 때 컴파일이 통과하고
 * 충돌은 「없다」가 아니라 조용히 사라진다 — renderMonteCarloSection이 params를 필수로
 * 받게 한 것과 같은 이유다.
 */
export function renderGoalConflictSection(verdict: GoalConflictVerdict): string {
  const described = describeGoalConflict(verdict);
  // 충돌이 없으면 undefined다. 그 하나로 「그리지 않는다」를 판정한다 — 빈 배열이나 빈
  // 문자열을 따로 검사하면 화면과 리포트가 각자의 「비었다」 기준을 갖게 된다.
  if (described === undefined) return '';

  const itemsHtml = described.shortfalls
    .map((shortfall) => `<li style="margin-bottom: 3px;">${shortfall}</li>`)
    .join('');
  // 「검증하지 못한 HARD 목표」 고지와 같은 경고 색을 쓴다. 같은 무게의 두 고지가 서로 다른
  // 색으로 말하면 읽는 사람은 둘을 다른 종류의 사건으로 받아들인다.
  return `
    <div style="border: 1px solid #fde68a; background-color: #fffbeb; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
      <p style="margin: 0; font-size: 12px; font-weight: 700; color: #b45309;">⚠ ${described.title}</p>
      <p style="margin: 4px 0 0; font-size: 11px; color: #b45309;">${described.lead}</p>
      <ul style="margin: 6px 0 0; padding-left: 18px; font-size: 11px; color: #b45309;">${itemsHtml}</ul>
    </div>
  `;
}

/**
 * 「지속가능 생활비」가 HARD 생활비 바닥을 존중해 다시 계산된 계획의 고지.
 *
 * 「현재 계획 진단」 안, 판정 블록 «바로 아래»에 놓인다(buildReportHtml) — 그 블록이 기말자산과
 * 고갈 나이를 말한 직후에 「그 숫자가 왜 이런가」가 와야 한다.
 *
 * **문장을 여기서 짓지 않는다.** describeSustainableSpendingLimit이 화면과 이 리포트에 같은
 * 말을 준다. 리포트는 화면보다 오래 남아 그대로 인용되므로, 문구가 두 벌이면 갈라진 쪽이
 * 오래 남는다(renderGoalConflictSection과 같은 이유).
 *
 * 바닥이 구속하지 않은 계획에서는 빈 문자열이다 — 달라진 것이 없으므로 자리도 만들지 않는다.
 */
export function renderSustainableSpendingLimitSection(input: SustainableSpendingLimitInput): string {
  const notice = describeSustainableSpendingLimit(input);
  if (notice === undefined) return '';

  // 조건부 문장은 있을 때만 문단이 된다. 빈 <p>를 남기면 리포트에 이유 없는 여백이 생긴다.
  const optional = [notice.terminalAssets, notice.depletionRisk]
    .filter((text): text is string => text !== undefined)
    .map((text) => `<p style="margin: 4px 0 0; font-size: 11px; color: #7f1d1d;">${text}</p>`)
    .join('');

  // 「리스크 알림」과 같은 경고 색을 쓴다. 같은 무게의 고지가 서로 다른 색으로 말하면 읽는
  // 사람은 둘을 다른 종류의 사건으로 받아들인다.
  return `
    <div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
      <p style="margin: 0; font-size: 12px; font-weight: 700; color: #ef4444;">⚠ ${notice.title}</p>
      <p style="margin: 4px 0 0; font-size: 11px; color: #7f1d1d;">${notice.reason}</p>
      <p style="margin: 4px 0 0; font-size: 11px; font-weight: 700; color: #7f1d1d;">${notice.limit}</p>
      ${optional}
    </div>
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
  /**
   * ☆추천 배지가 붙는 카드. 화면(StrategyRecommendationCards)이 받는 것과 같은 값이다.
   *
   * 여기서 규칙을 다시 쓰지 않는다. 예전에는 이 파일이 `find(persona === 'BALANCED')`로
   * 직접 골랐는데, 그 규칙은 「목표를 지킨 최고 확률 카드」로 바뀌면서 화면에서 삭제됐다.
   * 규칙이 두 벌이면 같은 계획을 두고 화면은 안정형에, 리포트는 균형형에 별을 붙인다.
   * 없으면 «아무 카드에도» 붙이지 않는다 — 첫 카드로 폴백하면 엔진이 고르지 않은 카드가
   * 추천으로 인쇄된다.
   */
  primary?: CandidateRecommendation | null;
  status: StrategyOptimizationStatus;
  unsupportedHardGoals?: readonly RetirementGoalType[];
  outcome?: OptimizationOutcome;
  /** 화면과 같은 출처의 격차 숫자. 도달 불가 문단에서만 쓰고, null이면 숫자 없이 사실만 적는다. */
  sustainableSpendingAdvice?: SustainableSpendingAdvice | null;
  params: SimulationParams;
  formatValue: (value: number) => string;
}): string {
  const {
    recommendations, primary, status, unsupportedHardGoals, outcome,
    sustainableSpendingAdvice, params, formatValue,
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

  // 화면(StrategyRecommendationCards)과 같은 자리에서, 같은 판정으로 돌아선다. 리포트는 화면보다
  // 오래 남고 그대로 인용되므로, 고를 이유가 없는 선택지를 표로 남기면 더 오래 오해된다.
  if (outcome?.kind === 'no_candidate_reaches_goal') {
    const gap = sustainableSpendingAdvice?.kind === 'overspending'
      ? `<table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
           <tbody>
             <tr><td style="padding: 4px 0; font-size: 11px; color: #64748b;">월 생활비 목표</td>
                 <td style="padding: 4px 0; font-size: 12px; font-weight: 700; color: #0f172a; text-align: right;">${formatValue(sustainableSpendingAdvice.currentMonthly)}</td></tr>
             <tr><td style="padding: 4px 0; font-size: 11px; color: #64748b;">지속 가능한 월 생활비</td>
                 <td style="padding: 4px 0; font-size: 12px; font-weight: 700; color: #0f172a; text-align: right;">${formatValue(sustainableSpendingAdvice.sustainableMonthly)}</td></tr>
             <tr><td style="padding: 4px 0; font-size: 11px; color: #64748b;">부족</td>
                 <td style="padding: 4px 0; font-size: 12px; font-weight: 700; color: #b91c1c; text-align: right;">${formatValue(sustainableSpendingAdvice.difference)}</td></tr>
           </tbody>
         </table>
         <p style="margin: 6px 0 0; font-size: 10.5px; color: #64748b;">${
           describeSustainableSpendingBasis(params.userProfile.expectancy)}</p>`
      : '';
    return `<div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 12px 14px;">
        <p style="margin: 0; font-size: 13px; font-weight: 700; color: #b91c1c;">어떤 전략으로도 목표에 도달하지 못합니다</p>
        <p style="margin: 6px 0 0; font-size: 12px; color: #475569;">전략 ${outcome.validatedCount}개를 검증했지만 모두 목표 달성 확률이 0%입니다.</p>
        ${gap}
        <p style="margin: 10px 0 0; font-size: 12px; color: #0f172a;">목표 생활비를 낮추거나, 은퇴 전 저축·연금 납입을 늘려야 합니다.</p>
      </div>`;
  }

  const finalRecommendations = recommendations ?? [];
  if (finalRecommendations.length === 0) {
    return notice(describeEmptyOutcome(outcome));
  }

  // 워커를 건너온 primary는 구조적 복제라 배열 원소와 다른 객체다. 화면과 같은 이유로
  // 참조가 아니라 id로 맞춘다.
  const recommendedId = primary?.candidate.candidate.id;

  // 검증할 수 없었던 HARD 목표를 밝힌다. 밝히지 않으면 "확인하지 않음"이 "확인해서 통과함"으로
  // 읽힌다 — 리포트는 화면보다 오래 남고 그대로 인용되므로 더 중요하다.
  const unsupportedHtml = unsupportedHardGoals && unsupportedHardGoals.length > 0
    ? `<p style="margin: 0 0 10px; font-size: 11px; color: #b45309; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px;">
         <strong>다음 「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」 목표는 현재 검증할 수 없습니다:</strong> ${unsupportedHardGoals.map(goalLabel).join(', ')}.
         아래 추천은 이 목표를 만족하는지 확인하지 않은 결과입니다.
       </p>`
    : '';

  const cardsHtml = finalRecommendations
    .map((recommendation) => {
      const candidate = recommendation.candidate;
      const isRecommended = recommendedId !== undefined
        && recommendation.candidate.candidate.id === recommendedId;
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
    <div style="display: flex; gap: 10px; align-items: stretch;">${cardsHtml}</div>
    <p style="margin: 10px 0 0; font-size: 10px; color: #94a3b8;">
      ※ 위 추천은 시뮬레이션 결과이며 실제 설정에 자동 반영되지 않습니다. 적용하려면 설정을 직접 변경하세요.
    </p>
  `;
}

function goalLabel(type: RetirementGoalType): string {
  return RETIREMENT_GOAL_CATALOG.find((goal) => goal.type === type)?.label ?? type;
}

// 결과가 없는 네 가지 원인을 구분한다. 화면(EmptyOutcomeCard)과 같은 이유다 — 하나로 묶으면
// 엔진이 전부 예외로 죽은 경우에도 "당신의 목표가 불가능하다"는 뜻으로 읽힌다.
function describeEmptyOutcome(outcome?: OptimizationOutcome): string {
  if (outcome?.kind === 'no_candidate_generated') {
    return '입력만으로는 비교할 전략을 만들지 못했습니다. 자산과 연금 정보가 입력되어 있는지 확인해 주세요.';
  }
  if (outcome?.kind === 'no_persona_matched') {
    return `전략 ${outcome.validatedCount}개를 검증했지만 안정형·균형형·여유형 중 어느 특성에도 해당하지 않아 추천을 만들지 못했습니다.`;
  }
  // 이 kind는 추천이 «있는» 경우에만 나오므로 현재 구조에서 여기까지 오지 않는다. 그래도
  // 적어 둔다 — 유니온이 늘었는데 이 함수만 모르면 조용히 마지막 폴백 문장으로 새어 나간다.
  if (outcome?.kind === 'no_candidate_reaches_goal') {
    return `전략 ${outcome.validatedCount}개를 검증했지만 모두 목표 달성 확률이 0%입니다. 목표 생활비를 낮추거나, 은퇴 전 저축·연금 납입을 늘려야 합니다.`;
  }
  if (outcome?.kind === 'no_candidate_survived') {
    const blocked = outcome.blockedBy.map(hardConstraintLabel).join(', ');
    const base = outcome.hardConstraintRejectedCount > 0
      ? `「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」로 정한 목표를 동시에 만족하는 전략을 찾지 못했습니다${blocked ? ` — 후보를 막은 조건: ${blocked}` : ''}. 해당 목표의 조건 강도를 「${RETIREMENT_GOAL_CONSTRAINT_LABELS.SOFT}」으로 바꾸거나 목표치를 조정하면 후보를 찾을 수 있습니다.`
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
// 예전에는 "자산 고갈 나이" 한 열뿐이었다. 여유 있는 계획에서는 모든 행이 전부 "평생 유지"로
// 찍혀 표 전체가 아무 정보도 주지 않았다(실제 리포트가 그랬다). 기말자산 열을 함께 실어
// 고갈 여부와 무관하게 시나리오가 구분되게 한다 — 화면의 SensitivityAnalysisSection과
// 같은 판단이다.
//
// 투자자산이 없는 계획에서는 그 기말자산마저 전부 0원이라 모든 행이 글자 하나까지 같아진다.
// 화면(SensitivityAnalysisSection)과 같은 규칙으로, baseline과 결과가 완전히 동일한 행은
// 접고 몇 개를 접었는지 밝힌다 — 두 문서가 서로 다른 표를 보여주면 안 된다.
export function renderSensitivityTableSection(
  scenarios: SensitivityScenario[],
  baseline?: {
    depletionAge: number | null;
    unmetSpendingYears: number;
    planAssetStatus: PlanAssetStatus;
    // scenarios가 공통으로 고정한 월 생활비. 화면(SensitivityAnalysisSection)과 같은 이유로
    // 반드시 밝힌다 — 「평생 소비 최적화」 계획에서는 이 값이 사용자가 입력한 목표와 다르다.
    frozenMonthlySpending?: number;
    // 사용자 «자신의» 수익률 가정(잔액가중 평균 총수익률, %). 굴릴 잔액이 없으면 null.
    // 화면과 같은 이유로 반드시 밝힌다 — 수익률 3행은 사용자 가정 대비 ±가 아니라 5/7/9%라는
    // 절대 앵커라서, 사용자 가정이 그보다 높으면 세 행이 전부 기준선 아래로 내려간다.
    weightedTotalReturn?: number | null;
    // 기준선의 기말자산. 표 안에 「현재 가정 (기준)」 행으로 한 줄 세운다 — 산문 속 금액과
    // 표 속 금액을 눈으로 이어 붙여야 비교가 되면 대부분 이어 붙이지 않는다.
    endingAssets?: number;
  }
): string {
  if (scenarios.length === 0) return '';

  const noInvestableAsset = baseline?.planAssetStatus === 'no_investable_asset';
  const frozenNoteHtml = baseline?.frozenMonthlySpending === undefined
    ? ''
    : `<p style="margin: 0 0 6px; font-size: 10.5px; color: #64748b;">${scenarios.length}개 시나리오 모두 <strong>월 생활비 ${formatManwon(baseline.frozenMonthlySpending)}을 고정</strong>한 채 가정 하나만 바꾼 결과입니다.</p>`;
  const visibleScenarios = noInvestableAsset
    ? scenarios.filter(
        (s) => !(s.endingAssetsDelta === 0
          && s.depletionAge === baseline.depletionAge
          && s.unmetSpendingYears === baseline.unmetSpendingYears)
      )
    : scenarios;
  const hiddenCount = scenarios.length - visibleScenarios.length;
  // 화면(SensitivityAnalysisSection)과 같은 문장·같은 자리.
  const returnNoteHtml = baseline?.weightedTotalReturn === undefined || baseline.weightedTotalReturn === null
    ? ''
    : `<p style="margin: 0 0 6px; font-size: 10.5px; color: #64748b;">현재 가정: 포트폴리오 <strong>가중평균 총수익률 ${
      Math.round(baseline.weightedTotalReturn * 10) / 10}%</strong> (사적연금 포함). ${describeYieldAxisAnchors()}</p>`;

  // 기준선 행. 투자자산이 없는 계획에서는 모든 값이 0원이라 「0원」을 한 번 더 반복할 뿐이므로
  // 그리지 않는다(화면과 같은 판단). 자리는 표의 맨 위 — 비교 «대상»이 아니라 비교의 «기준»이다.
  const baselineRowHtml = noInvestableAsset || baseline?.endingAssets === undefined
    ? ''
    : `<tr style="background-color: #f8fafc;">
         <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; vertical-align: middle; font-weight: 700; color: #0f172a;">현재 가정 (기준)</td>
         <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; text-align: right; vertical-align: middle; font-weight: 700;">${formatManwon(baseline.endingAssets)}</td>
         <td style="border: 1px solid #cbd5e1; padding: 8px 9px; font-size: 11px; line-height: 1.4; text-align: right; vertical-align: middle; white-space: nowrap;">${formatDepletionAgeText(baseline.depletionAge)}</td>
       </tr>`;

  const noteHtml = noInvestableAsset
    ? `<p style="margin: 6px 0 0; font-size: 10.5px; color: #64748b;">투자자산이 없어 수익률·물가 가정을 바꿔도 기말자산은 0원으로 동일합니다.${
        hiddenCount > 0 ? ` 결과가 동일한 ${hiddenCount}개 가정은 생략했습니다.` : ''
      }</p>`
    : '';

  const rowsHtml = visibleScenarios
    .map((s) => {
      const depletionText = formatDepletionAgeText(s.depletionAge);
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
    ${returnNoteHtml}
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
      <tbody>${baselineRowHtml}${rowsHtml}</tbody>
    </table>
    ${noteHtml}
  `;
}

// 화면(SensitivityAnalysisSection의 formatDepletionAge)과 같은 표기.
function formatDepletionAgeText(depletionAge: number | null): string {
  return depletionAge === null ? '평생 유지' : `${depletionAge}세`;
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
  sequenceRisk: SequenceRiskResult | undefined,
  // 실패 원인을 만든 «설정»을 지목하려면 필요하다(explainGoalShortfall). optional로 두지
  // 않는 이유는 그러면 호출자가 빠뜨렸을 때 원인 문장이 조용히 사라지기 때문이다.
  params: SimulationParams
): string {
  if (!monteCarlo) return '';

  const assetPercent = Math.round(monteCarlo.successRate * 100);
  const spendingPercent = Math.round(monteCarlo.spendingSuccessRate * 100);
  // 화면(MonteCarloSection)과 «같은 문장»이어야 한다. 두 벌로 두었던 대가는
  // describeMonteCarloAssumptions 주석에 있다.
  const assumptionCopy = describeMonteCarloAssumptions(monteCarlo);
  // 화면(MonteCarloSection)과 «같은 문장»이어야 한다. 두 캡션이 서술하는 판정 기준
  // (연령대별 목표 생활비 곡선)은 엔진의 것이므로 core가 만든다(describeSuccessRates 주석).
  const successRateCopy = describeSuccessRates({ monteCarlo, params, formatValue: formatManwon });

  const depletionText = monteCarlo.depletion.count > 0
    ? `<p style="margin: 6px 0 0; font-size: 11px; color: #dc2626;">자산이 먼저 바닥난 경우가 ${monteCarlo.depletion.count.toLocaleString()}회 있었고, 가장 이른 시점은 ${monteCarlo.depletion.earliestAge}세였습니다.</p>`
    : '';

  // 화면(DashboardSection의 「목표를 달성하지 못한 시행의 원인」)과 **같은 문장**이어야 한다.
  // 위 depletionText는 「무슨 일이 있었는가」만 말하고 원인은 말하지 않아, 예전에는 화면이
  // "목표 생활비를 못 채운다"라고 하는 같은 시행을 리포트는 "자산이 바닥났다"로만 적었다.
  // 두 문서가 같은 시행을 다르게 설명하면 사용자는 어느 조치를 해야 할지 알 수 없다 —
  // describeMonteCarloAssumptions를 한 벌로 모은 것과 같은 이유다.
  const shortfall = explainGoalShortfall({
    goalFailure: monteCarlo.goalFailure,
    trials: monteCarlo.trials,
    params,
    formatValue: formatManwon,
  });
  // **cause로 가르지 않는다.** 목표를 다 달성했는데도 자산은 실제로 고갈된 계획은 cause가
  // 'none'이면서(확률이 정말 100%다) 할 말이 있다. 예전에 여기서 cause를 보고 잘랐더니 그
  // 문장이 한 번도 화면에 닿지 못했다. 「보여줄지」와 「어떤 제목으로」는 문장을 만든 곳이
  // 함께 정한다(explainGoalShortfall의 label).
  const shortfallHtml = shortfall.label === undefined
    ? ''
    : `<p style="margin: 6px 0 0; font-size: 11px; color: #0f172a;"><strong>${shortfall.label}</strong> — ${shortfall.headline}</p>`
      + (shortfall.hint
        ? `<p style="margin: 2px 0 0; font-size: 10px; color: #64748b;">${shortfall.hint}</p>`
        : '');

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
        변동 없음 기준을 제외한 네 경로는 <strong>같은 수익률 집합을 사용합니다</strong> — 다른 것은 은퇴 후 순서뿐입니다.
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
  // **관계 문장을 두 비율보다 «앞»에 둔다.** 화면(MonteCarloSection)도 같은 순서이고,
  // 문장 자체가 「아래 두 비율」이라고 가리킨다. 예전에는 이 자리에 「그 확률을 이루는 두
  // 성분은 다음과 같습니다」가 있었는데, 그 말은 두 비율이 목표 달성 확률의 판정 술어와
  // 같다는 뜻으로 읽힌다 — 생활비 조건은 엡실론 유무가 달라 포함관계조차 없다
  // (spendingShortfall.ts의 AUDIT-003). describeSuccessRates가 그 선을 지킨 문장을 만든다.
  return `
    <p style="margin: 0; font-size: 11.5px; color: #475569;">
      1페이지 판정의 목표 달성 확률은 아래 가정으로 계산했습니다. 수익률이 해마다 오르내리는 상황을
      ${monteCarlo.trials.toLocaleString()}회 시뮬레이션한 결과입니다.${
        successRateCopy.compositeNote ? ` ${successRateCopy.compositeNote}` : ''}
    </p>
    <p style="margin: 4px 0 0; font-size: 11.5px; color: #475569;">
      <strong style="font-size: 14px; color: #0f172a;">생활 유지 성공률 ${spendingPercent}%</strong>
      — ${successRateCopy.spendingCaption}
      <strong>자산 보존 성공률 ${assetPercent}%</strong> — ${successRateCopy.assetCaption}
    </p>
    <p style="margin: 4px 0 0; font-size: 10px; color: #64748b;">
      계산 가정: ${assumptionCopy.calculation}
    </p>
    ${assumptionCopy.robustness
      ? `<p style="margin: 2px 0 0; font-size: 10px; color: #64748b;">${assumptionCopy.robustness}</p>`
      : ''}
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
        <!-- 결정론 기준선을 «같은 표의 중앙값 열»에 올린다. 예전에는 표 아래 각주였는데,
             그러면 독자가 표 안 중앙값과 표 밖 각주를 눈으로 이어 붙여야 격차가 보였다.
             화면(MonteCarloSection의 volatility-drag)이 두 값을 붙여 놓는 것과 같은 기준이다.
             분위수가 아니라 단일 경로의 값이라 하위/상위 칸은 비운다. -->
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; color: #64748b;">변동 없음 가정</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right; color: #94a3b8;">—</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${formatManwon(monteCarlo.deterministicEndingAssets)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right; color: #94a3b8;">—</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 6px 0 0; font-size: 11px; color: #64748b;">
      같은 평균 수익률이라도 해마다 오르내리면 결과는 이만큼 낮아집니다. 자산 추이 차트의
      총 자산액 곡선은 흔들리지 않는다고 가정한 값이라 아랫줄에 해당합니다.
    </p>
    ${depletionText}
    ${shortfallHtml}
    ${sequenceSection}
  `;
}
