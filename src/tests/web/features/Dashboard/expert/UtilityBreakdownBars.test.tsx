import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtilityBreakdownBars } from '@/web/features/Dashboard/expert/UtilityBreakdownBars';
import { UtilityBreakdown } from '@/core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

describe('UtilityBreakdownBars', () => {
  test('6개 구성요소의 라벨과 점수/만점을 모두 렌더링한다', () => {
    render(<UtilityBreakdownBars utility={utility} weights={DEFAULT_UTILITY_CONFIG.weights} />);

    expect(screen.getByText('소비 만족도')).toBeInTheDocument();
    expect(screen.getByText('27/35')).toBeInTheDocument();
    expect(screen.getByText('자산 고갈 방지')).toBeInTheDocument();
    expect(screen.getByText('20/20')).toBeInTheDocument();
    expect(screen.getByText('상속 자산 적정성')).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
  });

  // 목표 우선순위를 바꾸면 컴포넌트별 배점 자체가 바뀐다(OBJECTIVE_WEIGHT_PRESETS).
  // 예전에는 화면 메타가 기본 배점을 모듈 로드 시점에 고정해, '세금 최소화'를 고른 사용자
  // 화면에 "세금 효율 21/10", "과세 위험 관리 15/10"처럼 만점을 넘긴 분수가 찍히고
  // 막대는 100%에서 잘렸다.
  test('목표 우선순위가 바꾼 배점을 분모로 쓴다', () => {
    const taxMinUtility: UtilityBreakdown = {
      score: 55,
      components: { consumption: 6, depletionSafety: 0, pensionUtilization: 8, taxEfficiency: 21, taxationRisk: 15, bequestAdequacy: 5 },
    };

    render(<UtilityBreakdownBars utility={taxMinUtility} weights={OBJECTIVE_WEIGHT_PRESETS.tax_minimization} />);

    expect(screen.getByText('21/25')).toBeInTheDocument(); // 세금 효율
    expect(screen.getByText('15/15')).toBeInTheDocument(); // 과세 위험 관리
    expect(screen.getByText('6/25')).toBeInTheDocument(); // 소비 만족도
    expect(screen.queryByText('21/10')).not.toBeInTheDocument();
  });

  // 점수만으로는 "왜 6점인지"를 알 수 없어 개선할 방법도 없다. hover 툴팁이 아니라 항상
  // 보이는 줄로 두는 이유는 모바일·PDF에서 hover가 사라지기 때문이다.
  test('축별 근거를 넘기면 막대 아래에 항상 보이는 줄로 렌더링한다', () => {
    render(
      <UtilityBreakdownBars
        utility={utility}
        weights={DEFAULT_UTILITY_CONFIG.weights}
        explanations={{
          consumption: '은퇴 후 목표 월 350만원 대비 실제 소비는 평균 월 191만원(55%)입니다.',
          depletionSafety: '은퇴 시점에 이미 인출할 자산이 없습니다.',
          pensionUtilization: '은퇴 후 30년 중 26년 국민연금을 받습니다.',
          taxEfficiency: '평생 세전 소득의 약 4.6%를 세금·건강보험료로 냅니다.',
          taxationRisk: '금융소득종합과세 위험 연도가 없습니다.',
          bequestAdequacy: '목표 상속자산을 0원으로 설정하셨습니다.',
        }}
      />
    );

    expect(screen.getByText(/실제 소비는 평균 월 191만원\(55%\)/)).toBeInTheDocument();
    expect(screen.getByText(/은퇴 시점에 이미 인출할 자산이 없습니다/)).toBeInTheDocument();
  });

  test('근거를 넘기지 않으면 설명 줄 없이 기존과 동일하게 렌더링한다', () => {
    const { container } = render(
      <UtilityBreakdownBars utility={utility} weights={DEFAULT_UTILITY_CONFIG.weights} />
    );

    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.getByText('27/35')).toBeInTheDocument();
  });
});
