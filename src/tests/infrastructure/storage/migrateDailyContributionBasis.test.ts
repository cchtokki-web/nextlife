import { describe, test, expect } from 'vitest';
import { migrateDailyContributionBasis } from '@/infrastructure/storage/migrateDailyContributionBasis';
import {
  normalizeSimulationParams,
  normalizeSimulationParamsWithIssues,
} from '@/infrastructure/storage/normalizeSimulationParams';
import { initialParams } from '@/infrastructure/storage/localStore';

type MigratedAssets = { assets: Record<string, unknown>[] };

describe('migrateDailyContributionBasis', () => {
  // 회귀: 365일 기준으로 저장된 월 적립액이 남아 있으면 화면(250일)과 계산이 어긋난다.
  test('달력일 기준으로 저장된 매일 적립을 영업일 기준으로 다시 유도한다', () => {
    const raw = {
      assets: [{
        id: 'a', currency: 'KRW',
        contributionPeriod: 'daily', contributionAmount: 15_000,
        monthlyContribution: 456_250, // 15,000 × 365 / 12
      }],
    };
    const out = migrateDailyContributionBasis(raw) as MigratedAssets;
    expect(out.assets[0].monthlyContribution).toBe(312_500); // 15,000 × 250 / 12
    expect(out.assets[0].contributionAmount).toBe(15_000);
  });

  test('외화 자산은 센트 단위로 자른다', () => {
    const raw = {
      assets: [{ id: 'a', currency: 'USD', contributionPeriod: 'daily', contributionAmount: 10, monthlyContribution: 304.17 }],
    };
    const out = migrateDailyContributionBasis(raw) as MigratedAssets;
    expect(out.assets[0].monthlyContribution).toBe(208.33); // 10 × 250 / 12
  });

  test('매주·매월 자산과 1회 적립액이 없는 자산은 손대지 않는다', () => {
    const raw = {
      assets: [
        { id: 'w', currency: 'KRW', contributionPeriod: 'weekly', contributionAmount: 10_000, monthlyContribution: 43_333 },
        { id: 'm', currency: 'KRW', contributionPeriod: 'monthly', contributionAmount: 500_000, monthlyContribution: 500_000 },
        { id: 'n', currency: 'KRW', monthlyContribution: 300_000 },
        { id: 'd', currency: 'KRW', contributionPeriod: 'daily', monthlyContribution: 456_250 },
      ],
    };
    expect(migrateDailyContributionBasis(raw)).toBe(raw);
  });

  // 1회 적립액에서 유도하므로 몇 번을 돌려도 같다. 버전 마커가 필요 없는 근거다.
  test('두 번 적용해도 결과가 같다', () => {
    const raw = {
      assets: [{ id: 'a', currency: 'KRW', contributionPeriod: 'daily', contributionAmount: 15_000, monthlyContribution: 456_250 }],
    };
    const once = migrateDailyContributionBasis(raw);
    expect(migrateDailyContributionBasis(once)).toBe(once);
  });

  test('입력 객체를 변형하지 않는다', () => {
    const asset = { id: 'a', currency: 'KRW', contributionPeriod: 'daily', contributionAmount: 15_000, monthlyContribution: 456_250 };
    migrateDailyContributionBasis({ assets: [asset] });
    expect(asset.monthlyContribution).toBe(456_250);
  });

  test('객체가 아니거나 자산 목록이 없으면 그대로 돌려준다', () => {
    expect(migrateDailyContributionBasis(null)).toBe(null);
    expect(migrateDailyContributionBasis('x')).toBe('x');
    expect(migrateDailyContributionBasis({ userProfile: {} })).toEqual({ userProfile: {} });
  });

  // 정제 «앞»에서 돌아야 이슈 수집이 이 보정을 「금액이 대체됨」으로 잘못 보고하지 않는다.
  test('정제 경로가 보정을 적용하면서 거짓 경고를 남기지 않는다', () => {
    const raw = {
      ...initialParams,
      assets: [{
        id: 'a', type: 'etf', ticker: 'QQQ', name: 'QQQ',
        quantity: 1, averagePrice: 1_000_000, totalReturn: 9.5, dividendYield: 0.4,
        reinvestDividend: true, currency: 'KRW',
        contributionPeriod: 'daily', contributionAmount: 15_000,
        monthlyContribution: 456_250,
      }],
    };

    expect(normalizeSimulationParams(raw).assets[0].monthlyContribution).toBe(312_500);

    const { params, issues } = normalizeSimulationParamsWithIssues(raw);
    expect(params.assets[0].monthlyContribution).toBe(312_500);
    expect(issues.filter((issue) => issue.path.includes('monthlyContribution'))).toEqual([]);
  });
});
