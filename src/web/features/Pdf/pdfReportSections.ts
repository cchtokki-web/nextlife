import { RiskAlert } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { SensitivityScenario } from '../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { PlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { ShortfallSummary } from '../../../core/usecases/dashboard/computeShortfallSummary';
import {
  ItemizedContribution, ItemizedContributionField, StrategyRecommendation,
} from '../../../core/entities/types';
import { formatManwon } from '../../../core/usecases/utility/utilityAnalysis';
import { MonteCarloResult } from '../../../core/entities/montecarlo';
import { SequenceRiskResult } from '../../../core/usecases/montecarlo/sequenceRisk';

export function formatCurrencyUnit(currency: 'KRW' | 'USD'): '원' | '$' {
  return currency === 'KRW' ? '원' : '$';
}

// PDF는 화면과 별개로 완전히 독립된 정적 HTML 문자열을 html2canvas로 캡처하는 구조라(page.tsx의
// handleDownload), 화면 컴포넌트를 재사용할 수 없다 — 동일한 usecase 데이터를 받아 PDF 전용
// 인라인 스타일 HTML 문자열로 변환하는 순수 함수만 여기 둔다. 기존 handleDownload가 이미 자산/
// 연금 이름 등을 이스케이프 없이 직접 보간하는 것과 동일한 관례를 따른다(신규 도입 아님).

// "현재 계획을 유지하면" 세 줄. 화면의 ShortfallSummaryCard와 같은 값·같은 각주를 쓴다 —
// 리포트만 가정을 빼면 사용자가 확정된 목표 금액으로 읽는다.
export function renderShortfallSummarySection(
  summary: ShortfallSummary | null,
  formatValue: (val: number) => string
): string {
  if (!summary) return '';
  const cell = (label: string, value: string) => `
    <div style="flex: 1;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">${label}</p>
      <p style="margin: 2px 0 0; font-size: 15px; font-weight: 700; color: #dc2626;">${value}</p>
    </div>
  `;
  return `
    <div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 12px 14px; margin-top: 12px;">
      <p style="margin: 0 0 8px; font-size: 12.5px; font-weight: 700; color: #0f172a;">현재 계획을 유지하면</p>
      <div style="display: flex; gap: 14px;">
        ${cell('부족 생활비', `월 평균 ${formatValue(summary.averageMonthlyShortfall)}`)}
        ${cell('부족 기간', `${summary.shortfallYears}년 (${summary.firstShortfallAge}세 ~ ${summary.lastShortfallAge}세)`)}
        ${cell('추가로 필요한 자산', `약 ${formatValue(summary.totalShortfallInTodayValue)}`)}
      </div>
      <p style="margin: 8px 0 0; font-size: 10px; color: #64748b; line-height: 1.5;">
        * 추가로 필요한 자산은 부족분을 그대로 채우는 데 드는 금액입니다. 수익률이 물가상승률과 같다고 볼 때의
        현재 구매력 기준이며, 투자 수익을 가정하면 더 적은 금액으로도 가능합니다.
      </p>
    </div>
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

// 리포트의 항목별 체크리스트. 화면의 RecommendationChecklist와 같은 규칙을 따라야 한다 —
// AI 센티널이 이미 계산에 넣은 축은 "할 일"이 아니라 "이미 반영됨"이다. 이 구분이 없으면
// 리포트가 인쇄한 숫자는 70세 기준인데 같은 장에서 "70세로 바꾸세요"라고 시키게 된다.
export function renderItemizedChecklistSection(
  recommendation: StrategyRecommendation | undefined,
  appliedFields: ReadonlyArray<ItemizedContributionField> = []
): string {
  const items = recommendation?.itemizedContributions ?? [];
  if (!recommendation || !recommendation.improved || items.length === 0) {
    return '<p style="font-size: 12px; color: #64748b;">현재 설정이 이미 최적입니다. 추가로 추천할 변경 사항이 없습니다.</p>';
  }

  const renderItem = (item: ItemizedContribution, applied: boolean) => {
    const sign = item.utilityDelta >= 0 ? '+' : '';
    const color = item.utilityDelta >= 0 ? '#10B981' : '#EF4444';
    const appliedNote = applied
      ? '<span style="color: #2563eb; font-size: 10px; margin-left: 6px;">이 값으로 계산 중</span>'
      : '';
    return `
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 12px;">
          <span>${applied ? '✓' : '☐'} ${item.label}${appliedNote}</span>
          <span style="font-weight: 700; color: ${color}; white-space: nowrap; margin-left: 10px;">효용 ${sign}${item.utilityDelta}점</span>
        </div>
      `;
  };

  const alreadyApplied = items.filter((i) => appliedFields.includes(i.field));
  const remaining = items.filter((i) => !appliedFields.includes(i.field));
  const heading = (text: string) =>
    `<p style="font-size: 11px; font-weight: 700; color: #475569; margin: 8px 0 2px;">${text}</p>`;

  if (alreadyApplied.length === 0) {
    return remaining.map((i) => renderItem(i, false)).join('');
  }

  return [
    heading('이미 반영됨'),
    ...alreadyApplied.map((i) => renderItem(i, true)),
    ...(remaining.length > 0 ? [heading('남은 할 일'), ...remaining.map((i) => renderItem(i, false))] : []),
  ].join('');
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
  }
): string {
  if (scenarios.length === 0) return '';

  const noInvestableAsset = baseline?.planAssetStatus === 'no_investable_asset';
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

  const successPercent = Math.round(monteCarlo.successRate * 100);
  const fullSpendingPercent = Math.round(monteCarlo.fullSpendingRate * 100);

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

  return `
    <p style="margin: 0; font-size: 11.5px; color: #475569;">
      수익률이 해마다 오르내리는 상황을 ${monteCarlo.trials.toLocaleString()}회 시뮬레이션한 결과,
      <strong style="font-size: 14px; color: #0f172a;">${successPercent}%</strong>의 경우에
      ${monteCarlo.successAge}세까지 자산이 남았습니다.
      목표 생활비를 한 해도 줄이지 않고 유지한 경우는 ${fullSpendingPercent}%입니다.
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
