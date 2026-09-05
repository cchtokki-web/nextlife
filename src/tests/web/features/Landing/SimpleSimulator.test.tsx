import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SimpleSimulator } from '@/web/features/Landing/SimpleSimulator';
import {
  SimpleSimulationAdapter,
  type InvestmentPropensity,
  type SimpleSimulationInput,
} from '@/core/usecases/SimpleSimulationAdapter';

describe('SimpleSimulator 금액 입력', () => {
  // 저장값(원)을 곧바로 되돌려 그리면 지우는 순간 0이 다시 찍혀 «0»을 지울 수 없다.
  test('금액을 지우면 화면은 빈 칸으로 남고 이어서 새 금액을 칠 수 있다', () => {
    render(<SimpleSimulator />);
    const input = document.querySelector('input[name="currentAssets"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });

    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '3000' } });

    expect(input).toHaveValue('3,000');
  });

  test('포커스를 잃으면 저장된 금액을 만원 단위 콤마 표기로 되돌린다', () => {
    render(<SimpleSimulator />);
    const input = document.querySelector('input[name="monthlyInvestment"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('0');
  });
});

// 결과 카드가 말하는 수익률은 «엔진에 실제로 들어가는 값»이어야 한다.
//
// 예전에는 카드에 「기대 자산 성장 연 3%」·「기대 배당 연 4%」가 손으로 적혀 있었다. 이 숫자는
// 총수익률 표기 이관(2026-08-19) 이전의 성장률로, 어댑터가 넘기는 totalReturn 7%와 달랐다.
// 게다가 어댑터는 reinvestDividend=true라 엔진이 세후 배당을 자산에 되돌리므로, 화면이 말한
// 「자산 성장 3%」는 옆에 그려진 곡선의 기울기와도 맞지 않았다.
//
// 기대값을 어댑터 결과에서 끌어온다 — 화면과 엔진 입력이 갈라지는 순간 여기서 멈춘다.
describe('SimpleSimulator 결과 카드의 수익률 표기', () => {
  const baseInput: SimpleSimulationInput = {
    currentAge: 45,
    retirementAge: 62,
    currentAssets: 200000000,
    monthlyInvestment: 1500000,
    nationalPension: 1200000,
    targetMonthlySpending: 3000000,
    propensity: 'neutral',
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ isDevMode: false }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runWith(propensity: InvestmentPropensity, buttonPattern: RegExp) {
    render(<SimpleSimulator />);
    fireEvent.click(screen.getByRole('button', { name: buttonPattern }));
    fireEvent.click(screen.getByRole('button', { name: '내 노후자금 계산하기' }));
    return SimpleSimulationAdapter.adapt({ ...baseInput, propensity }).assets[0];
  }

  function cardValue(label: string): string {
    return screen.getByText(label).parentElement?.textContent ?? '';
  }

  test('중립형 카드는 어댑터가 엔진에 넘기는 총수익률과 그 안의 배당 몫을 그대로 말한다', () => {
    const asset = runWith('neutral', /중립형/);

    expect(cardValue('기대 총수익률 (배당 포함)')).toContain(`연 ${asset.totalReturn}%`);
    expect(cardValue('그중 배당·이자 몫')).toContain(`연 ${asset.dividendYield}%`);
  });

  test('안전추구 카드는 어댑터가 엔진에 넘기는 총수익률과 그 안의 배당 몫을 그대로 말한다', () => {
    const asset = runWith('conservative', /안전추구/);

    expect(cardValue('기대 총수익률 (배당 포함)')).toContain(`연 ${asset.totalReturn}%`);
    expect(cardValue('그중 배당·이자 몫')).toContain(`연 ${asset.dividendYield}%`);
  });

  test('공격형 카드는 어댑터가 엔진에 넘기는 총수익률과 그 안의 배당 몫을 그대로 말한다', () => {
    const asset = runWith('aggressive', /공격형/);

    expect(cardValue('기대 총수익률 (배당 포함)')).toContain(`연 ${asset.totalReturn}%`);
    expect(cardValue('그중 배당·이자 몫')).toContain(`연 ${asset.dividendYield}%`);
  });
});
