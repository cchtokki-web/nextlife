import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetFormSection } from '@/web/features/AssetForm/AssetFormSection';
import { SimulationParams } from '@/core/entities/types';

// 탭 클릭 시 handleTabClick이 scrollIntoView를 부르는데 jsdom에는 구현이 없다.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 인적사항(나이/생활비/목표 상속자산) 탭은 좌측 "내 은퇴 전략" 패널의 ①기본정보·②은퇴목표로
// 옮겨졌다. 같은 값을 두 곳에서 편집할 수 있으면 어느 쪽이 진짜인지 알 수 없어진다.
describe('AssetFormSection - 인적사항 탭 제거됨', () => {
  test('인적사항 탭 버튼과 중복 입력 필드를 렌더링하지 않는다', () => {
    render(<AssetFormSection params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /인적사항/ })).not.toBeInTheDocument();
    for (const label of ['현재 나이', '목표 은퇴 나이', '기대 수명', '목표 상속자산', '은퇴 생활비 전략']) {
      expect(screen.queryByText(label), label).not.toBeInTheDocument();
    }
  });

  test('기본 탭은 주식 & ETF이며 자산 추가 UI가 바로 보인다', () => {
    render(<AssetFormSection params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('button', { name: /주식 & ETF/ })).toBeInTheDocument();
    expect(screen.getByText(/자산 추가/)).toBeInTheDocument();
  });
});

// 사적연금 수령 개시 나이 설정 기능(WithdrawalPlan.privatePensionStartAge) 제거 회귀 가드.
// 연금 탭을 실제로 열어 확인한다 — 닫힌 탭에서 없음을 확인하면 항상 통과하는 빈 테스트가 된다.
describe('AssetFormSection - 사적연금 수령 개시 나이 UI 제거됨', () => {
  test('사적연금 계좌가 있어도 수령 개시 나이 입력 UI를 렌더링하지 않는다', () => {
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 100000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
    };
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));

    expect(screen.queryByText(/사적연금 수령 개시 나이/)).not.toBeInTheDocument();
    expect(screen.queryByText('수령 개시 나이')).not.toBeInTheDocument();
  });
});
