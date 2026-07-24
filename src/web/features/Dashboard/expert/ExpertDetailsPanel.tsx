'use client';

import { Collapse } from '../../../components/ui';
import { SimulationParams, SimulationResult, UtilityBreakdown } from '../../../../core/entities/types';
import { computeExpertAnalytics } from '../../../../core/usecases/dashboard/computeExpertAnalytics';
import { YearlyChart } from '../YearlyChart';
import { UtilityBreakdownBars } from './UtilityBreakdownBars';
import { CurrentStrategyAnalysis } from './CurrentStrategyAnalysis';

interface ExpertDetailsPanelProps {
  result: SimulationResult;
  params: SimulationParams;
  utility?: UtilityBreakdown;
  bequestAdequacyExplanation?: string;
  isPro?: boolean;
  formatValue: (val: number) => string;
}

// 세금/건보료/인출순서/연금구성/금융소득종합과세/상속 등 전문가용 상세 분석. 기본 닫힘 상태이며,
// DashboardSection에서 계산만 되고 렌더링되지 않던 세금/리스크 분석값(computeExpertAnalytics)을 소비한다.
export function ExpertDetailsPanel({
  result,
  params,
  utility,
  bequestAdequacyExplanation,
  isPro = false,
  formatValue,
}: ExpertDetailsPanelProps) {
  const analytics = computeExpertAnalytics(result, params);

  return (
    <Collapse title={<span className="text-base font-semibold">전문가용 상세 분석 더 보기</span>} className="mb-6">
      <div className="flex flex-col gap-6 pt-2">
        {utility && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Lifetime Utility Score 구성</h4>
            <UtilityBreakdownBars utility={utility} />
            {bequestAdequacyExplanation && (
              <p className="mt-2 text-xs text-foreground-muted">* 상속 자산 적정성: {bequestAdequacyExplanation}</p>
            )}
          </section>
        )}

        {utility && (
          <section>
            <CurrentStrategyAnalysis utility={utility} />
          </section>
        )}

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
              <dt className="text-foreground-muted">건강보험료</dt>
              <dd className="font-semibold">{formatValue(analytics.avgHealthInsurance)}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">세후 순소득</dt>
              <dd className="font-semibold">{formatValue(analytics.avgNetIncome)}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">연금 구성 및 리스크</h4>
          <ul className="flex flex-col gap-1.5 text-xs text-foreground-muted">
            <li>
              국민연금은 {analytics.firstAgeWithNationalPension}세부터 수령을 시작합니다
              {analytics.pensionGapYears > 0 ? ` (은퇴 후 ${analytics.pensionGapYears}년의 연금 공백 기간이 있습니다)` : ''}.
            </li>
            {analytics.everComprehensiveTax && (
              <li className="text-danger">⚠️ 금융소득종합과세 대상이 되는 연도가 있습니다.</li>
            )}
            {analytics.hasHighPrivatePensionRisk && (
              <li className="text-warning">⚠️ 사적연금 저율과세 한도를 초과하는 연도가 있어 세금 부담이 늘어날 수 있습니다.</li>
            )}
            {analytics.hasSignificantDividends && (
              <li>배당소득 비중이 상당해 금융소득종합과세 여부를 주기적으로 점검하는 것이 좋습니다.</li>
            )}
          </ul>
        </section>

        {isPro && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">연도별 상세 내역</h4>
            <YearlyChart params={params} result={result} />
          </section>
        )}
      </div>
    </Collapse>
  );
}
