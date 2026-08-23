import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SimulationParams } from '@/core/entities/types';

// PDF 내보내기가 «목표 충돌 한 필드»를 얻는 방법.
//
// 예전에는 이 자리에서 LegacyEvaluationEngine을 새로 만들어 evaluate()를 통째로 돌렸다.
// 리스크 알림·차트 캡션·부족 요약·지속가능액 조언이 함께 계산됐고, 리포트는 그중 어느 것도
// 그 호출에서 읽지 않았다 — 같은 값을 제 손으로 다시 계산한다. 필드 하나를 읽으려고 문서
// 한 벌을 더 만드는 셈이었다.
//
// 단위 테스트로는 잡히지 않는 결함이다. evaluateGoalConflict가 옳게 동작한다는 것과 «배선이
// 그것을 부른다»는 것은 다른 명제라, 배선을 확인하려면 실제로 화면을 세우고 버튼을 눌러야 한다.
// 그래서 이 테스트는 시뮬레이터 페이지를 실제로 렌더해 분석 → 내보내기를 그대로 지나간다.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
}));

// jsPDF·html2canvas는 동적 import라 jsdom에서 띄울 수 없고, 여기서 시험하는 것은 PDF 파일이
// 아니라 «조립된 리포트 HTML»이다. 그것을 붙잡아 두고 충돌 고지가 실려 있는지 확인한다.
vi.mock('@/web/features/Pdf/generateReportPdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/features/Pdf/generateReportPdf')>();
  return { ...actual, generateReportPdf: vi.fn(async () => {}) };
});

// jsdom에는 matchMedia가 없다. 사이드바 접힘 판정에만 쓰이므로 데스크톱 폭으로 고정한다.
window.matchMedia = window.matchMedia ?? ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
} as unknown as MediaQueryList));

import Home from '@/app/simulator/page';
import { generateReportPdf } from '@/web/features/Pdf/generateReportPdf';
import { ThemeProvider } from '@/web/components/providers/ThemeProvider';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SIMULATOR_PARAMS_KEY } from '@/infrastructure/storage/storageKeys';
import { LegacyEvaluationEngine } from '@/core/evaluation/LegacyEvaluationEngine';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';

// 목표 충돌이 «성립하는» 계획. HARD 생활비 바닥이 HARD 상속 하한선을 깨서 리포트에 고지가
// 실린다 — 고지가 비어 있으면 "엔진을 안 불렀다"가 "판정이 사라졌다"와 구분되지 않는다.
const conflictingPlan = {
  ...initialParams,
  userProfile: { currentAge: 60, retirementAge: 65, expectancy: 68, targetMonthlySpending: 5_000_000 },
  assets: [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 300_000_000,
    totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }],
  isaAccounts: [], otherIncomes: [], privatePensions: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  inflationRate: 0, inflationMode: 'nominal',
  retirementGoals: [
    { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'HARD', targetValue: 5_000_000 },
    { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
  ],
} as unknown as SimulationParams;

describe('PDF 내보내기의 목표 충돌 배선', () => {
  test('충돌 고지는 실리되, 평가 엔진을 통째로 다시 돌리지는 않는다', async () => {
    const fullEvaluation = vi.spyOn(LegacyEvaluationEngine.prototype, 'evaluate');
    const goalEvaluation = vi.spyOn(DefaultGoalEvaluationEngine.prototype, 'evaluate');
    localStorage.setItem(SIMULATOR_PARAMS_KEY, JSON.stringify(conflictingPlan));

    render(<ThemeProvider><Home /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /분석 시작/ }));

    const download = await screen.findByRole('button', { name: /결과 다운로드/ });
    await waitFor(() => expect(download).not.toBeDisabled());
    // 화면(DashboardSection)의 평가가 끝난 뒤부터 센다. 관심사는 «내보내기가 무엇을 더
    // 돌리는가»이지, 화면을 세우는 데 무엇이 필요한가가 아니다.
    await waitFor(() => expect(goalEvaluation).toHaveBeenCalled());
    fullEvaluation.mockClear();
    goalEvaluation.mockClear();

    fireEvent.click(download);
    await waitFor(() => expect(generateReportPdf).toHaveBeenCalled());

    // 충돌 판정은 내보내기 경로에서 «한 번» 선다. 예전에는 그 한 번이 전체 평가 안에 들어
    // 있어, 리포트가 쓰지 않는 계산 열한 가지를 함께 끌고 왔다.
    expect(fullEvaluation).not.toHaveBeenCalled();
    expect(goalEvaluation).toHaveBeenCalledTimes(1);

    const pagesHtml = vi.mocked(generateReportPdf).mock.calls[0][0];
    // 고지의 «문장»은 describeGoalConflict가, 자리는 buildReportHtml이 소유한다. 여기서
    // 확인하는 것은 판정이 리포트까지 도달했다는 사실 하나다.
    expect(pagesHtml).toContain('동시에 달성하기 어려운 목표가 있습니다');
  });
});
