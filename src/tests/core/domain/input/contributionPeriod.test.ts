import { describe, test, expect } from 'vitest';
import {
  CONTRIBUTION_DAYS_PER_YEAR,
  contributionsPerMonth,
  convertContributionAmount,
  roundContributionForCurrency,
  toMonthlyContribution,
} from '@/core/domain/input/contributionPeriod';

describe('적립 주기 환산', () => {
  // 회귀: 예전에는 달력일 365로 세어 연 납입액이 46% 부풀려졌다.
  test('매일 적립은 영업일 250일 기준으로 월 환산한다', () => {
    expect(CONTRIBUTION_DAYS_PER_YEAR).toBe(250);
    expect(contributionsPerMonth('daily')).toBeCloseTo(250 / 12, 10);
    expect(toMonthlyContribution(15_000, 'daily')).toBeCloseTo(312_500, 6);
    expect(toMonthlyContribution(15_000, 'daily') * 12).toBeCloseTo(15_000 * 250, 6);
  });

  test('매주는 52주, 매월은 그대로다', () => {
    expect(toMonthlyContribution(10_000, 'weekly')).toBeCloseTo(10_000 * 52 / 12, 10);
    expect(toMonthlyContribution(500_000, 'monthly')).toBe(500_000);
  });

  test('주기를 바꿔도 연 납입액이 같다', () => {
    const daily = 15_000;
    const monthly = convertContributionAmount(daily, 'daily', 'monthly');
    const weekly = convertContributionAmount(daily, 'daily', 'weekly');

    expect(monthly * 12).toBeCloseTo(daily * 250, 6);
    expect(weekly * 52).toBeCloseTo(daily * 250, 6);
    expect(convertContributionAmount(monthly, 'monthly', 'daily')).toBeCloseTo(daily, 6);
  });

  test('통화별 표시 단위로 자른다', () => {
    expect(roundContributionForCurrency(312_500.4, 'KRW')).toBe(312_500);
    expect(roundContributionForCurrency(20.836, 'USD')).toBe(20.84);
  });
});
