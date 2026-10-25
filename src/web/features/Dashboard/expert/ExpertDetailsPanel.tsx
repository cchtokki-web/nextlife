'use client';

import { useMemo } from 'react';
import GlassCard from '../../../components/GlassCard';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { computeExpertAnalytics } from '../../../../core/usecases/dashboard/computeExpertAnalytics';
import { SensitivityAnalysis } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { estimateHealthInsuranceCliff } from '../../../../core/usecases/healthcare/estimateHealthInsuranceCliff';
import { resolveTaxContext } from '../../../../core/usecases/tax/taxContext';
import { YearlyChart } from '../YearlyChart';
import { SensitivityAnalysisSection } from './SensitivityAnalysisSection';
import { LedgerDebugPanel } from './LedgerDebugPanel';

interface ExpertDetailsPanelProps {
  result: SimulationResult;
  params: SimulationParams;
  isPro?: boolean;
  formatValue: (val: number) => string;
  // 호출부(DashboardSection)가 계산해 내려준다. 여기서 다시 돌리면 시뮬레이션 7회가 두 배가
  // 되고, 핵심 레버 카드와 이 표가 서로 다른 실행 결과를 말할 수 있다.
  sensitivity: SensitivityAnalysis;
}

// 세금/건보료/연금구성/금융소득종합과세/민감도 상세. computeExpertAnalytics가 계산한 값을 소비한다.
//
// **자체 Collapse를 두지 않는다.** 이 패널은 이미 접혀 있는 「계획의 근거」 안에 있어서,
// 예전처럼 안쪽에 또 접힘을 두면 세금 표 하나를 보는 데 세 번을 열어야 했다
// (<details> "상세 분석" → 그룹 "상세 분석" → Collapse "전문가용 상세 분석 더 보기").
export function ExpertDetailsPanel({
  result,
  params,
  isPro = false,
  formatValue,
  sensitivity,
}: ExpertDetailsPanelProps) {
  const analytics = computeExpertAnalytics(result, params);
  // 위 연평균 건보료와 같은 result를 근거로 삼는다 — 두 숫자가 나란히 놓이므로 서로 다른
  // 실행에서 온 값이면 안 된다(민감도 기준선이 params로 재계산하는 것과는 반대 이유다).
  const healthInsuranceCliff = useMemo(
    () => estimateHealthInsuranceCliff(
      result.yearlyResults,
      resolveTaxContext(params.taxSettings, params.taxLawVersion)
    ),
    [result.yearlyResults, params.taxSettings, params.taxLawVersion]
  );
  const hasUnassessedStatutoryPensionLimit = useMemo(
    () => result.yearlyResults.some((year) => year.privatePensionAccountLedgers?.some(
      (account) => account.statutoryLimitAssessment?.status === 'not_assessable'
    )),
    [result.yearlyResults]
  );

  return (
    <GlassCard>
      <div className="flex flex-col gap-6">
          <section>
            <h4 className="mb-2 text-sm font-semibold">세금 및 건강보험료 (은퇴 이후 연평균)</h4>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-foreground-muted">세전 소득</dt>
                <dd className="font-semibold">{formatValue(analytics.avgPreTaxIncome)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">세금 합계</dt>
                <dd className="font-semibold">{formatValue(analytics.avgTotalTax)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">예상 건강보험료</dt>
                <dd className="font-semibold">{formatValue(analytics.avgHealthInsurance)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">세후 순소득</dt>
                <dd className="font-semibold">{formatValue(analytics.avgNetIncome)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
              세금은 <strong className="text-foreground">2024년 기준 단순화 모델</strong>입니다. 부양가족·추가공제,
              재산·자동차분 건강보험료, 일부 국내상장 해외·채권형 ETF의 과세 차이는 반영하지 않습니다.
            </p>
            {/* 이 모델의 가장 큰 오차원인데 화면 어디에도 적혀 있지 않았다. 부양가족·추가공제와
                같은 방향(세금이 실제보다 높게 나온다)이라 위 문장과 나란히 둔다.
                근거는 TaxEngine.calculatePensionIncomeTaxKRW의 「알려진 과대 계상」 주석. */}
            {(params.nationalPension?.expectedMonthlyAmount ?? 0) > 0 && (
              <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
                국민연금은 실제로 <strong className="text-foreground">2002년 이후 납입분에 대응하는 부분만</strong> 과세되지만,
                납입 이력 입력이 없어 전액을 과세 대상으로 계산합니다. 그래서 국민연금 세액은 실제보다
                높게 나오며, 이것이 이 세금 모델의 가장 큰 오차원입니다.
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
              예상 건강보험료는 현금흐름 계산값이고, 피부양자 자격 위험은 세전 판정용 소득으로 별도 평가합니다.
              따라서 보험료가 0원이어도 자격 위험이 표시될 수 있습니다. 재산 입력이 없어 최종 피부양자
              자격은 확정하지 않고 <strong>소득 기준 위험만</strong> 표시합니다.
            </p>
            {/* 위 건강보험료는 이 시뮬레이터의 모델(문턱 초과분 × 요율)이 부과한 값이다.
                실제 제도는 피부양자 자격을 잃는 순간 소득 전체에 부과되므로 훨씬 크다.
                그 계단을 계산에 넣지 않는 이유는 estimateHealthInsuranceCliff 주석 참고.

                리스크 경고 카드는 부과 기준 소득이 문턱의 90~110%인 "경계 구간"에서만 뜨므로,
                이미 문턱을 크게 넘어선 사용자는 그 카드를 보지 못한다. 여기서는 조건 없이 보여준다. */}
            {healthInsuranceCliff && (
              <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-xs text-foreground-muted">
                <strong className="text-danger">피부양자 자격 상실 시</strong>{' '}
                부담이 가장 큰 {healthInsuranceCliff.peakAge}세 기준으로, 위 계산상 월{' '}
                {formatValue(Math.round(healthInsuranceCliff.currentMonthly))}인 보험료가 월{' '}
                <strong>{formatValue(Math.round(healthInsuranceCliff.ifDependentLostMonthly))}</strong>까지 오릅니다
                (연 {formatValue(Math.round(healthInsuranceCliff.annualIncrease))} 추가 부담).
                이 추정은 소득분만 계산한 것이라 <strong>재산·자동차분</strong>이 더 붙습니다.
              </p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold">연금 구성 및 리스크</h4>
            <ul className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              <li>
                {analytics.firstAgeWithNationalPension === null
                  ? '국민연금 없이 사적연금·배당·기타소득으로 생활비를 충당합니다.'
                  : `국민연금은 ${analytics.firstAgeWithNationalPension}세부터 수령을 시작합니다` +
                    (analytics.pensionGapYears > 0 ? ` (은퇴 후 ${analytics.pensionGapYears}년의 연금 공백 기간이 있습니다)` : '') +
                    '.'}
              </li>
              {analytics.hasSignificantDividends && (
                <li>배당소득 비중이 상당해 금융소득종합과세 여부를 주기적으로 점검하는 것이 좋습니다.</li>
              )}
              {hasUnassessedStatutoryPensionLimit && (
                <li>
                  계좌 잔액·운용수익·인출·세금 원장은 검증되지만, 법정 연금수령한도는 연금수령 기산연도와
                  과세기간 개시일 평가액 입력이 없어 미판정입니다. 화면의 연 1,500만원은 저율과세 기준으로,
                  법정 연금수령한도와 다른 값입니다.
                </li>
              )}
            </ul>
          </section>

          <SensitivityAnalysisSection
            baselineDepletionAge={sensitivity.baselineDepletionAge}
            baselineEndingAssets={sensitivity.baselineEndingAssets}
            baselineUnmetSpendingYears={sensitivity.baselineUnmetSpendingYears}
            baselineHardViolations={sensitivity.baselineHardViolations}
            frozenMonthlySpending={sensitivity.frozenMonthlySpending}
            baselineWeightedTotalReturn={sensitivity.baselineWeightedTotalReturn}
            scenarios={sensitivity.scenarios}
            hardRequirementGoals={sensitivity.hardRequirementGoals}
            planAssetStatus={sensitivity.baselinePlanAssetStatus}
          />

          {isPro && (
            <section>
              <h4 className="mb-2 text-sm font-semibold">연도별 상세 내역</h4>
              <YearlyChart params={params} result={result} />
            </section>
          )}

          {/* 개발 모드에서만 보이는 회계 원장. LoginForm이 쓰는 것과 같은 플래그다. */}
          {process.env.NEXT_PUBLIC_DEV_MODE === 'true' && (
            <LedgerDebugPanel result={result} params={params} />
          )}
      </div>
    </GlassCard>
  );
}
