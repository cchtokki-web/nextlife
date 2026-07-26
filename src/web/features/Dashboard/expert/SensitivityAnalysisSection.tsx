import { SensitivityScenario } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';

interface SensitivityAnalysisSectionProps {
  baselineDepletionAge: number | null;
  scenarios: SensitivityScenario[];
}

function formatDepletionAge(depletionAge: number | null): string {
  return depletionAge === null ? '평생 유지' : `${depletionAge}세`;
}

function formatDeltaYears(deltaYears: number | null): string | null {
  if (deltaYears === null) return null;
  const sign = deltaYears > 0 ? '+' : '';
  return `${sign}${deltaYears}년`;
}

// 기준선과 6개 시나리오가 전부 "평생 유지"이면 막대 6줄이 전부 동일한 정보(고갈 없음)만
// 반복해 구분되는 정보가 없다 — 이 경우 상세 막대 대신 한 줄 요약으로 접는다.
function isUniformlyLifetime(baselineDepletionAge: number | null, scenarios: SensitivityScenario[]): boolean {
  return baselineDepletionAge === null && scenarios.length > 0 && scenarios.every((s) => s.depletionAge === null);
}

// 6개 시나리오의 자산 고갈 나이 변화를 가로 막대로 보여준다. deltaYears의 절대값을 막대
// 길이(최대값 기준 정규화)로, 부호를 색상(악화=danger/개선=success)으로 표현한다.
// "평생 유지"(depletionAge===null) 시나리오는 괄호 델타를 표시하지 않는다 — deltaYears가
// expectancy 치환으로 계산된 근사치라 "평생 유지(+4년)" 같은 문구는 오히려 혼란을 준다.
export function SensitivityAnalysisSection({ baselineDepletionAge, scenarios }: SensitivityAnalysisSectionProps) {
  const maxAbsDelta = Math.max(1, ...scenarios.map((s) => Math.abs(s.deltaYears ?? 0)));

  if (isUniformlyLifetime(baselineDepletionAge, scenarios)) {
    return (
      <section>
        <h4 className="mb-1 text-sm font-semibold">민감도 분석 (핵심 가정 변화에 따른 자산 고갈 나이)</h4>
        <p className="text-xs text-foreground-muted">
          투자수익률 ±2%p, 물가상승률 ±1%p, 은퇴시점 ±3년 등 주요 가정이 나빠지는 경우를 포함해도 평생 자산 고갈 위험이 없습니다.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">민감도 분석 (핵심 가정 변화에 따른 자산 고갈 나이)</h4>
      <p className="mb-3 text-xs text-foreground-muted">
        현재 설정 기준: {formatDepletionAge(baselineDepletionAge)}
      </p>
      <div className="flex flex-col gap-2">
        {scenarios.map((scenario) => {
          const deltaText = formatDeltaYears(scenario.deltaYears);
          const isWorse = (scenario.deltaYears ?? 0) < 0;
          const isBetter = (scenario.deltaYears ?? 0) > 0;
          const widthPercent = Math.min(100, (Math.abs(scenario.deltaYears ?? 0) / maxAbsDelta) * 100);

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
              <span className="w-32 shrink-0 text-right font-semibold">
                {formatDepletionAge(scenario.depletionAge)}
                {scenario.depletionAge !== null && deltaText && (
                  <span className="ml-1 font-normal text-foreground-muted">({deltaText})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
