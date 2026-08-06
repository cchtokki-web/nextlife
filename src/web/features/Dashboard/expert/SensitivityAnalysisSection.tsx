import { SensitivityScenario } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { formatManwon } from '../../../../core/usecases/utility/utilityAnalysis';

interface SensitivityAnalysisSectionProps {
  baselineDepletionAge: number | null;
  baselineEndingAssets: number;
  scenarios: SensitivityScenario[];
}

function formatDepletionAge(depletionAge: number | null): string {
  return depletionAge === null ? '평생 유지' : `${depletionAge}세`;
}

// 6개 시나리오가 핵심 가정 변화에 따라 어떻게 갈리는지 가로 막대로 보여준다.
//
// **막대의 기준을 고갈 나이에서 기말자산으로 바꾼 이유.**
//
// 예전에는 depletionAge의 델타만 막대로 그렸고, 6개가 전부 "평생 유지"(null)이면 상세를
// 접고 "고갈 위험이 없습니다" 한 줄만 남겼다. 그런데 여유 있는 계획에서는 그것이 늘
// 참이라, 실제 리포트에서 수익률 ±2%p가 기말자산을 수십억 갈라놓는데도 화면에는 아무
// 차이가 없었다 — 정보량이 0인 요약이었다.
//
// 기말자산은 고갈 여부와 무관하게 항상 연속적으로 변하므로 모든 계획에서 구분되는 정보를
// 준다. 고갈이 발생하는 계획에서는 고갈 나이를 함께 붙여 예전 정보도 잃지 않는다.
export function SensitivityAnalysisSection({
  baselineDepletionAge,
  baselineEndingAssets,
  scenarios,
}: SensitivityAnalysisSectionProps) {
  // 막대 길이는 기말자산 증감의 절대값을 최대값 기준으로 정규화한다. 0으로 나누지 않도록
  // 하한을 1로 둔다(모든 시나리오의 증감이 0인 경우 — 자산이 없는 계획 등).
  const maxAbsDelta = Math.max(1, ...scenarios.map((s) => Math.abs(s.endingAssetsDelta)));
  const allLifetime = baselineDepletionAge === null && scenarios.every((s) => s.depletionAge === null);

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">민감도 분석 (핵심 가정 변화에 따른 영향)</h4>
      <p className="mb-3 text-xs text-foreground-muted">
        현재 설정 기준: 기말자산 {formatManwon(baselineEndingAssets)} · 자산 고갈 {formatDepletionAge(baselineDepletionAge)}
        {allLifetime && ' — 아래 가정이 나빠지는 경우를 포함해도 고갈 위험이 없습니다. 다만 남는 자산의 규모는 크게 달라집니다.'}
      </p>
      <div className="flex flex-col gap-2">
        {scenarios.map((scenario) => {
          const isWorse = scenario.endingAssetsDelta < 0;
          const isBetter = scenario.endingAssetsDelta > 0;
          const widthPercent = Math.min(100, (Math.abs(scenario.endingAssetsDelta) / maxAbsDelta) * 100);
          const deltaSign = isBetter ? '+' : '';

          return (
            <div key={scenario.key} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 text-foreground-muted">{scenario.label}</span>
              <div className="h-2 flex-1 rounded-full bg-foreground/5">
                <div
                  data-testid="sensitivity-bar"
                  data-key={scenario.key}
                  className={`h-2 rounded-full ${isWorse ? 'bg-danger' : isBetter ? 'bg-success' : 'bg-foreground/20'}`}
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <span className="w-44 shrink-0 text-right">
                <span className="font-semibold">{formatManwon(scenario.endingAssets)}</span>
                {scenario.endingAssetsDelta !== 0 && (
                  <span className={`ml-1 font-normal ${isWorse ? 'text-danger' : 'text-success'}`}>
                    ({deltaSign}
                    {formatManwon(scenario.endingAssetsDelta)})
                  </span>
                )}
                {/* 고갈과 생활비 미충족은 "얼마 남았나"와는 다른 층위의 실패 신호라 별도 줄에 둔다.
                    특히 미충족은 자산이 남아 있어도 발생하므로(인출 경로가 잔액을 넘겨 인출하지
                    않는다) 기말자산만 보면 놓친다. */}
                {(scenario.depletionAge !== null || scenario.unmetSpendingYears > 0) && (
                  <span className="block text-[11px] font-normal text-danger">
                    {scenario.depletionAge !== null && `${scenario.depletionAge}세 고갈`}
                    {scenario.depletionAge !== null && scenario.unmetSpendingYears > 0 && ' · '}
                    {scenario.unmetSpendingYears > 0 && `생활비 부족 ${scenario.unmetSpendingYears}년`}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
