import { RiskAlert } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { SensitivityScenario } from '../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { StrategyRecommendation } from '../../../core/entities/types';

// PDF는 화면과 별개로 완전히 독립된 정적 HTML 문자열을 html2canvas로 캡처하는 구조라(page.tsx의
// handleDownload), 화면 컴포넌트를 재사용할 수 없다 — 동일한 usecase 데이터를 받아 PDF 전용
// 인라인 스타일 HTML 문자열로 변환하는 순수 함수만 여기 둔다. 기존 handleDownload가 이미 자산/
// 연금 이름 등을 이스케이프 없이 직접 보간하는 것과 동일한 관례를 따른다(신규 도입 아님).

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

export function renderItemizedChecklistSection(recommendation: StrategyRecommendation | undefined): string {
  const items = recommendation?.itemizedContributions ?? [];
  if (!recommendation || !recommendation.improved || items.length === 0) {
    return '<p style="font-size: 12px; color: #64748b;">현재 설정이 이미 최적입니다. 추가로 추천할 변경 사항이 없습니다.</p>';
  }
  return items
    .map((item) => {
      const sign = item.utilityDelta >= 0 ? '+' : '';
      const color = item.utilityDelta >= 0 ? '#10B981' : '#EF4444';
      return `
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 12px;">
          <span>✓ ${item.label}</span>
          <span style="font-weight: 700; color: ${color}; white-space: nowrap; margin-left: 10px;">${sign}${item.utilityDelta.toFixed(1)} Utility</span>
        </div>
      `;
    })
    .join('');
}

export function renderExecutionRoadmapSection(roadmap: ExecutionRoadmap): string {
  const eventsHtml = roadmap.events
    .map((event) => {
      const itemsHtml = event.items
        .map(
          (item) => `
            <div style="margin-bottom: 2px;">
              <strong style="font-size: 12px; color: #0f172a;">${item.title}</strong>
              <span style="font-size: 11px; color: #64748b;"> — ${item.description}</span>
            </div>
          `
        )
        .join('');
      return `
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
          <div style="width: 50px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #3b82f6;">${event.age}세</div>
          <div style="flex-grow: 1;">${itemsHtml}</div>
        </div>
      `;
    })
    .join('');
  return `
    ${eventsHtml}
    <div style="display: flex; gap: 10px; margin-top: 4px;">
      <div style="width: 50px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #94a3b8;">${roadmap.expectancy}세</div>
      <div style="flex-grow: 1; font-size: 12px; color: #94a3b8;">기대수명</div>
    </div>
  `;
}

export function renderSensitivityTableSection(scenarios: SensitivityScenario[]): string {
  if (scenarios.length === 0) return '';
  const rowsHtml = scenarios
    .map((s) => {
      const depletionText = s.depletionAge === null ? '평생 유지' : `${s.depletionAge}세`;
      return `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px;">${s.label}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${depletionText}</td>
        </tr>
      `;
    })
    .join('');
  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <thead>
        <tr>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">시나리오</th>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">자산 고갈 나이</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}
