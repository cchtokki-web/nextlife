'use client';

import { useMemo } from 'react';
import { Collapse } from '../../../components/ui';
import GlassCard from '../../../components/GlassCard';
import { SimulationParams, SimulationResult } from '../../../../core/entities/types';
import { SimulationEngine } from '../../../../core/usecases/SimulationEngine';
import { computeExpertAnalytics } from '../../../../core/usecases/dashboard/computeExpertAnalytics';
import { computeSensitivityAnalysis } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { YearlyChart } from '../YearlyChart';
import { SensitivityAnalysisSection } from './SensitivityAnalysisSection';

interface ExpertDetailsPanelProps {
  result: SimulationResult;
  params: SimulationParams;
  isPro?: boolean;
  formatValue: (val: number) => string;
}

// 세금/건보료/인출순서/연금구성/금융소득종합과세/상속 등 전문가용 상세 분석. 기본 닫힘 상태이며,
// DashboardSection에서 계산만 되고 렌더링되지 않던 세금/리스크 분석값(computeExpertAnalytics)을 소비한다.
// "평생 효용 점수 구성"/"현재 전략 분석"은 UtilityInsightSection으로 승격되어 여기서는 다루지 않는다.
export function ExpertDetailsPanel({
  result,
  params,
  isPro = false,
  formatValue,
}: ExpertDetailsPanelProps) {
  const analytics = computeExpertAnalytics(result, params);
  const engine = useMemo(() => new SimulationEngine(), []);
  // 민감도 분석은 Before/After 토글과 무관하게 항상 "현재 설정(params)" 자체의 취약성을
  // 보여줘야 하므로, 화면에 표시 중인 result(토글에 따라 추천안 결과일 수 있음)를 신뢰하지 않고
  // params로부터 직접 기준선을 재계산한다.
  const sensitivityBaseline = useMemo(() => engine.runForUtility(params), [params, engine]);
  const sensitivityScenarios = useMemo(
    () => computeSensitivityAnalysis(params, sensitivityBaseline, engine),
    [params, sensitivityBaseline, engine]
  );

  return (
    <GlassCard className="mb-6">
      <Collapse title={<span className="font-display text-base font-semibold">전문가용 상세 분석 더 보기</span>}>
        <div className="flex flex-col gap-6 pt-2">
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
                {analytics.firstAgeWithNationalPension === null
                  ? '국민연금 없이 사적연금·배당·기타소득으로 생활비를 충당합니다.'
                  : `국민연금은 ${analytics.firstAgeWithNationalPension}세부터 수령을 시작합니다` +
                    (analytics.pensionGapYears > 0 ? ` (은퇴 후 ${analytics.pensionGapYears}년의 연금 공백 기간이 있습니다)` : '') +
                    '.'}
              </li>
              {analytics.hasSignificantDividends && (
                <li>배당소득 비중이 상당해 금융소득종합과세 여부를 주기적으로 점검하는 것이 좋습니다.</li>
              )}
            </ul>
          </section>

          <SensitivityAnalysisSection baselineDepletionAge={sensitivityBaseline.depletionAge} scenarios={sensitivityScenarios} />

          {isPro && (
            <section>
              <h4 className="mb-2 text-sm font-semibold">연도별 상세 내역</h4>
              <YearlyChart params={params} result={result} />
            </section>
          )}
        </div>
      </Collapse>
    </GlassCard>
  );
}
