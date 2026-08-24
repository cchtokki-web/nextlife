import React from 'react';
import { describeYieldAxisAnchors, SensitivityScenario } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { formatManwon } from '../../../../core/usecases/utility/utilityAnalysis';

interface SensitivityAnalysisSectionProps {
  baselineDepletionAge: number | null;
  baselineEndingAssets: number;
  // 결과가 baseline과 완전히 같은 시나리오를 가려내는 데 쓴다. 자산이 없는 계획에서는
  // 기말자산·고갈 나이가 전부 같아, 이 축까지 봐야 "정말 아무것도 달라지지 않았는가"를 판정할 수 있다.
  baselineUnmetSpendingYears?: number;
  // scenarios가 공통으로 고정한 월 생활비. **반드시 밝혀야 한다** — 밝히지 않으면
  // 사용자는 자기가 입력한 목표 생활비 기준으로 표를 읽는다. 「평생 소비 최적화」 계획에서는
  // 이 값이 입력한 목표와 다르다.
  frozenMonthlySpending?: number;
  // 사용자 «자신의» 수익률 가정(잔액가중 평균 총수익률, %). 굴릴 잔액이 없으면 null/미지정.
  //
  // **이 값이 없으면 수익률 3행을 읽을 수 없다.** 세 행은 사용자 가정 대비 ±가 아니라
  // 5/7/9%라는 절대 앵커다(computeSensitivityAnalysis의 SCENARIO_DEFINITIONS 주석).
  // 사용자 가정이 그보다 높으면 세 행이 전부 기준선 아래로 내려가고, 그 사실을 모르는
  // 사용자는 「공격형으로 바꿨는데 왜 돈이 줄지」라고 읽는다.
  baselineWeightedTotalReturn?: number | null;
  scenarios: SensitivityScenario[];
  planAssetStatus?: PlanAssetStatus;
}

function formatDepletionAge(depletionAge: number | null): string {
  return depletionAge === null ? '평생 유지' : `${depletionAge}세`;
}

// 12.345 → '12.3'. 유도값이라 자릿수를 늘려도 사용자가 쓸 수 있는 정보가 늘지 않는다
// (describeAssumptions의 배율 표기와 같은 판단).
function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

// scenarios(현재 7개: 수익률 프리셋 3종 + 물가상승률 ±1%p + 은퇴시점 ±3년)가 핵심 가정
// 변화에 따라 어떻게 갈리는지 가로 막대로 보여준다.
//
// **막대의 기준을 고갈 나이에서 기말자산으로 바꾼 이유.**
//
// 예전에는 depletionAge의 델타만 막대로 그렸고, 전부 "평생 유지"(null)이면 상세를
// 접고 "고갈 위험이 없습니다" 한 줄만 남겼다. 그런데 여유 있는 계획에서는 그것이 늘
// 참이라, 실제 리포트에서 수익률 ±2%p가 기말자산을 수십억 갈라놓는데도 화면에는 아무
// 차이가 없었다 — 정보량이 0인 요약이었다.
//
// 기말자산은 고갈 여부와 무관하게 항상 연속적으로 변하므로 모든 계획에서 구분되는 정보를
// 준다. 고갈이 발생하는 계획에서는 고갈 나이를 함께 붙여 예전 정보도 잃지 않는다.
//
// **투자자산이 없는 계획은 그 기말자산마저 전부 0원이다.** 수익률·물가 가정을 어떻게
// 흔들어도 굴릴 원금이 없어 결과가 baseline과 글자 하나까지 같다. 그 4행을 그대로 두면
// "0원 · 51세 고갈 · 생활비 부족 31년"이 여섯 번 반복되어, 분석이 있는데 아무것도 구분하지
// 못하는 화면이 된다. 그래서 그 경우에만 (1) 이유를 밝히고 (2) 결과가 동일한 행은 접고
// (3) 실제로 갈리는 축인 생활비 부족 연수로 막대를 다시 그린다.
export function SensitivityAnalysisSection({
  baselineDepletionAge,
  baselineEndingAssets,
  baselineUnmetSpendingYears,
  frozenMonthlySpending,
  baselineWeightedTotalReturn,
  scenarios,
  planAssetStatus,
}: SensitivityAnalysisSectionProps) {
  const noInvestableAsset = planAssetStatus === 'no_investable_asset';

  // 접는 판정은 시나리오 key 하드코딩이 아니라 "결과가 정말 같은가"로 한다 — 자산이 없어도
  // 은퇴시점처럼 실제로 결과를 바꾸는 가정은 남아야 하고, 어떤 가정이 그런지는 데이터가 정한다.
  const isIdenticalToBaseline = (s: SensitivityScenario) =>
    s.endingAssetsDelta === 0
    && s.depletionAge === baselineDepletionAge
    && s.unmetSpendingYears === (baselineUnmetSpendingYears ?? 0);

  const visibleScenarios = noInvestableAsset ? scenarios.filter((s) => !isIdenticalToBaseline(s)) : scenarios;
  const hiddenCount = scenarios.length - visibleScenarios.length;

  // 막대 길이는 증감의 절대값을 최대값 기준으로 정규화한다. 0으로 나누지 않도록 하한을 1로 둔다.
  // 자산이 없는 계획에서는 금액 증감이 전부 0이라 정규화 대상이 생활비 부족 연수의 증감이 된다.
  const deltaOf = (s: SensitivityScenario) =>
    noInvestableAsset ? s.unmetSpendingYears - (baselineUnmetSpendingYears ?? 0) : s.endingAssetsDelta;
  const maxAbsDelta = Math.max(1, ...visibleScenarios.map((s) => Math.abs(deltaOf(s))));
  const allLifetime = baselineDepletionAge === null && scenarios.every((s) => s.depletionAge === null);

  // **기준선을 목록 «안»에 한 줄로 끼워 넣는다.** 위 문단에도 금액이 있지만, 산문 속 숫자와
  // 목록 속 숫자를 눈으로 이어 붙여야 비교가 되면 대부분 이어 붙이지 않는다. 같은 줄 형식으로
  // 나란히 두면 7개 행이 어느 값을 기준으로 갈렸는지가 보인다.
  //
  // 자리는 목록의 정렬 규칙(고갈이 빠른 순, 평생 유지는 뒤)을 그대로 따르되 동률 그룹의
  // 맨 앞에 둔다 — 기준선은 비교 «대상»이 아니라 비교의 «기준»이라 그 그룹을 여는 줄이다.
  // sortAge는 computeSensitivityAnalysis가 쓰는 것과 같은 식으로 되살린다(depletionAge ?? ∞).
  //
  // 투자자산이 없는 계획에서는 그리지 않는다. 그 계획은 모든 값이 0원이라 기준선 한 줄이
  // 더해 봐야 「0원」이 한 번 더 반복될 뿐이고, 그 사실은 위 안내문이 이미 말한다.
  const baselineSortAge = baselineDepletionAge ?? Infinity;
  const baselineRowIndex = noInvestableAsset
    ? -1
    : (() => {
      const found = visibleScenarios.findIndex((s) => (s.depletionAge ?? Infinity) >= baselineSortAge);
      return found === -1 ? visibleScenarios.length : found;
    })();

  const baselineRow = (
    <div className="flex items-center gap-3 text-xs" data-testid="sensitivity-baseline-row">
      <span className="w-28 shrink-0 font-semibold">현재 가정 (기준)</span>
      {/* 막대를 그리지 않는다. 기준선의 증감은 정의상 0이고, 길이 0인 막대를 그리면
          「가장 나쁜 경우」로 읽힌다. */}
      <div className="h-2 flex-1 rounded-full bg-foreground/5" />
      <span className="w-44 shrink-0 text-right">
        <span className="font-semibold">{formatManwon(baselineEndingAssets)}</span>
        {baselineDepletionAge !== null && (
          <span className="block text-[11px] font-normal text-danger">{baselineDepletionAge}세 고갈</span>
        )}
      </span>
    </div>
  );

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">민감도 분석 (핵심 가정 변화에 따른 영향)</h4>
      {frozenMonthlySpending !== undefined && (
        <p className="mb-1 text-xs text-foreground-muted">
          {scenarios.length}개 시나리오 모두 <strong>월 생활비 {formatManwon(frozenMonthlySpending)}을 고정</strong>한 채
          가정 하나만 바꾼 결과입니다.
        </p>
      )}
      {noInvestableAsset ? (
        <p className="mb-3 text-xs text-foreground-muted">
          투자자산이 없어 수익률·물가 가정을 바꿔도 기말자산은 0원으로 동일합니다. 아래는 실제로
          결과가 달라지는 가정만 남긴 것입니다
          {hiddenCount > 0 && ` — 나머지 ${hiddenCount}개 가정은 결과가 동일해 생략했습니다`}.
        </p>
      ) : (
        <>
          <p className="mb-1 text-xs text-foreground-muted">
            현재 설정 기준: 기말자산 {formatManwon(baselineEndingAssets)} · 자산 고갈 {formatDepletionAge(baselineDepletionAge)}
            {allLifetime && ' — 아래 가정이 나빠지는 경우를 포함해도 고갈 위험이 없습니다. 다만 남는 자산의 규모는 크게 달라집니다.'}
          </p>
          {/* **사용자 자신의 수익률을 함께 말한다.** 아래 세 행(안정형 5%·중립형 7%·공격형 9%)은
              현재 가정 대비 ±가 아니라 고정된 절대 기준이라, 사용자 가정이 그보다 높으면 셋 다
              기준선 아래로 내려간다. 그 숫자를 보여주지 않으면 「수익률을 높였는데 왜 돈이
              줄지」라는 읽기를 막을 방법이 없다. */}
          {baselineWeightedTotalReturn !== null && baselineWeightedTotalReturn !== undefined && (
            <p className="mb-3 text-xs text-foreground-muted" data-testid="sensitivity-baseline-return">
              현재 가정: 포트폴리오 <strong>가중평균 총수익률 {formatPercent(baselineWeightedTotalReturn)}</strong>
              {' '}(사적연금 포함). {describeYieldAxisAnchors()}
            </p>
          )}
        </>
      )}
      <div className="flex flex-col gap-2">
        {baselineRowIndex === 0 && baselineRow}
        {visibleScenarios.map((scenario, index) => {
          const delta = deltaOf(scenario);
          // 생활비 부족 연수는 늘어나는 쪽이 나쁘다 — 금액과 부호의 의미가 반대다.
          const isWorse = noInvestableAsset ? delta > 0 : delta < 0;
          const isBetter = noInvestableAsset ? delta < 0 : delta > 0;
          const widthPercent = Math.min(100, (Math.abs(delta) / maxAbsDelta) * 100);
          const deltaSign = scenario.endingAssetsDelta > 0 ? '+' : '';

          return (
            <React.Fragment key={scenario.key}>
            {index > 0 && index === baselineRowIndex && baselineRow}
            <div className="flex items-center gap-3 text-xs">
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
                {noInvestableAsset ? (
                  // 금액(0원)과 고갈 나이(전 시나리오 동일)는 정보가 없으므로 빼고, 갈리는 값만 남긴다.
                  <span className="font-semibold">생활비 부족 {scenario.unmetSpendingYears}년</span>
                ) : (
                  <>
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
                  </>
                )}
              </span>
            </div>
            </React.Fragment>
          );
        })}
        {baselineRowIndex === visibleScenarios.length && visibleScenarios.length > 0 && baselineRow}
      </div>
    </section>
  );
}
