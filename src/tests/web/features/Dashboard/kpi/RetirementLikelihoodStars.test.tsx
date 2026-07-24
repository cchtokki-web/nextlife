import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RetirementLikelihoodStars } from '@/web/features/Dashboard/kpi/RetirementLikelihoodStars';

describe('RetirementLikelihoodStars', () => {
  test('높은 점수는 매우 안정 등급과 별 5개를 접근성 라벨로 노출한다', () => {
    render(<RetirementLikelihoodStars score={92} />);
    expect(screen.getByLabelText('매우 안정 등급, 5점 만점에 5점')).toBeInTheDocument();
    expect(screen.getByText('매우 안정')).toBeInTheDocument();
  });

  test('낮은 점수는 위험 등급과 별 1개를 노출한다', () => {
    render(<RetirementLikelihoodStars score={45} />);
    expect(screen.getByLabelText('위험 등급, 5점 만점에 1점')).toBeInTheDocument();
  });
});
