import { describe, test, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { IncomeCompositionChart } from '@/web/features/Dashboard/charts/IncomeCompositionChart';
import { REFERENCE_LABEL_FONT_SIZE } from '@/web/features/Dashboard/charts/chartFormatters';
import { SimulationParams, SimulationResult, YearlyLedger } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

// recharts의 ResponsiveContainer는 ResizeObserver로 크기를 잰다. jsdom에는 그 API가
// 없어서 컨테이너 크기가 0으로 남고, 그러면 SVG 자체가 그려지지 않아 좌표를 볼 수 없다.
// 고정 크기를 즉시 통지하는 스텁을 넣어 실제 <svg>가 나오게 한다.
beforeAll(() => {
  class FixedSizeResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const contentRect = {
        width: CHART_WIDTH, height: CHART_HEIGHT,
        top: 0, left: 0, bottom: CHART_HEIGHT, right: CHART_WIDTH, x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly;
      this.cb(
        [{ target, contentRect } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: CHART_WIDTH });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: CHART_HEIGHT });
});

const CHART_WIDTH = 900;
const CHART_HEIGHT = 400;

const params: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const result: SimulationResult = {
  yearlyResults: [63, 64, 65, 66, 67].map((age) => makeYearlyResult({
    age,
    nationalPensionIncome: age >= 65 ? 12000000 : 0,
    privatePensionIncome: 6000000,
  })),
  fireAge: 60,
  depletionAge: null,
  endingAssets: 0,
  retirementScore: 80,
  retirementGrade: '안정',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 0,
};

function renderChart(chartResult = result) {
  return render(
    <IncomeCompositionChart
      params={params}
      result={chartResult}
      hiddenKeys={{}}
      onLegendClick={() => {}}
      caption=""
      nationalPensionStartAge={65}
    />
  );
}

function findReferenceLabel(container: HTMLElement): SVGTextElement {
  const label = Array.from(container.querySelectorAll('text'))
    .find((t) => t.textContent === '65세 국민연금 시작');
  expect(label, '국민연금 개시 기준선 라벨이 그려져야 한다').toBeTruthy();
  return label as unknown as SVGTextElement;
}

describe('IncomeCompositionChart - 국민연금 개시 기준선 라벨', () => {
  // 회귀: 플롯 위쪽 여백이 ⚠️ 표시분(12px)밖에 없어서, 그 위에 얹히는 라벨의 글자
  // 윗부분이 SVG 바깥(y < 0)으로 나가 잘렸다. 화면에서는 글자가 「깨진」 것처럼 보였다.
  test('라벨이 SVG 위쪽으로 잘리지 않는다', () => {
    const { container } = renderChart();
    const label = findReferenceLabel(container);

    // recharts는 이 라벨을 baseline 기준 y로 그린다. 글자 윗변은 그보다 한 줄 위다.
    const baselineY = Number(label.getAttribute('y'));
    expect(Number.isNaN(baselineY)).toBe(false);
    expect(baselineY - REFERENCE_LABEL_FONT_SIZE).toBeGreaterThanOrEqual(0);
  });

  // 회귀: 0.65rem(≈10.4px) 굵은 한글은 받침이 뭉개져 「시작」이 「시삭」처럼 읽혔다.
  test('라벨 글자 크기가 한글이 뭉개지지 않는 크기다', () => {
    const { container } = renderChart();
    const label = findReferenceLabel(container);

    const fontSize = Number(
      label.getAttribute('font-size') ?? window.getComputedStyle(label).fontSize.replace('px', '')
    );
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });
});

describe('IncomeCompositionChart - 재투자 배당', () => {
  test('현금소득 막대와 다른 청록색 점선으로 그린다', () => {
    const chartResult: SimulationResult = {
      ...result,
      yearlyResults: result.yearlyResults.map((row, index) => index === 0
        ? {
            ...row,
            ledger: {
              investmentReturn: { dividendRetainedNet: 12_340_000 },
            } as YearlyLedger,
          }
        : row),
    };

    const { container, getByRole } = renderChart(chartResult);
    const retainedLine = container.querySelector('.recharts-line-curve');
    const legendButton = getByRole('button', { name: '재투자 배당 (소득 제외) 숨기기' });

    expect(retainedLine).toHaveAttribute('stroke', '#22D3EE');
    expect(legendButton.querySelector('[aria-hidden="true"]')).toHaveStyle({
      borderTop: '2px dashed #22D3EE',
    });
  });
});
