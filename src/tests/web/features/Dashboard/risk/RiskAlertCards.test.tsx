import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskAlertCards } from '@/web/features/Dashboard/risk/RiskAlertCards';
import { RiskAlert } from '@/core/usecases/dashboard/computeRiskAlerts';

describe('RiskAlertCards', () => {
  test('알림이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<RiskAlertCards alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('알림이 있으면 각각의 title/message를 렌더링한다', () => {
    const alerts: RiskAlert[] = [
      {
        key: 'healthInsurance',
        title: '건강보험료 증가 구간',
        message: '65~72세 구간, 건강보험료가 소득의 5%를 초과합니다.',
      },
      {
        key: 'comprehensiveTax',
        title: '금융소득종합과세 진입 가능성',
        message: '70세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.',
      },
    ];
    render(<RiskAlertCards alerts={alerts} />);

    expect(screen.getByText('건강보험료 증가 구간')).toBeInTheDocument();
    expect(screen.getByText('65~72세 구간, 건강보험료가 소득의 5%를 초과합니다.')).toBeInTheDocument();
    expect(screen.getByText('금융소득종합과세 진입 가능성')).toBeInTheDocument();
    expect(
      screen.getByText('70세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.')
    ).toBeInTheDocument();
  });
});
