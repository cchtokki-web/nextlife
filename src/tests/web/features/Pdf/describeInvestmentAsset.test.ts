import { describe, test, expect } from 'vitest';
import { describeInvestmentAssetLabel } from '@/web/features/Pdf/describeInvestmentAsset';
import type { InvestmentAsset } from '@/core/entities/types';

// 리포트가 계좌 종류는 한글로 부르면서(「IRP」·「일반형」) 투자자산만 원시 enum을 그대로
// 찍고 있었다 — 「KODEX 200 (etf)」. 같은 문서 안에서 표기 언어가 갈렸다.

function asset(overrides: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: 'a1',
    type: 'etf',
    ticker: '069500',
    name: 'KODEX 200',
    quantity: 2000,
    averagePrice: 35_000,
    totalReturn: 5,
    dividendYield: 2,
    monthlyContribution: 400_000,
    reinvestDividend: true,
    currency: 'KRW',
    ...overrides,
  };
}

describe('describeInvestmentAssetLabel', () => {
  test('종류를 한글로 부른다', () => {
    expect(describeInvestmentAssetLabel(asset({ type: 'etf' }))).toBe('KODEX 200 (ETF)');
    expect(describeInvestmentAssetLabel(asset({ type: 'stock', name: '삼성전자' }))).toBe('삼성전자 (개별주식)');
  });

  // InvestmentAsset.name은 필수 필드라 지금은 비어 있을 수 없지만, 사적연금에서 같은 문제가
  // 실제로 터졌다(「undefined (IRP)」). 두 자리가 같은 규칙을 쓰게 둔다.
  test('이름이 비어 있으면 종류만 보여준다', () => {
    expect(describeInvestmentAssetLabel(asset({ name: '' }))).toBe('ETF');
    expect(describeInvestmentAssetLabel(asset({ name: '   ' }))).toBe('ETF');
  });

  test('알 수 없는 종류는 기타로 부른다', () => {
    expect(describeInvestmentAssetLabel(asset({ name: '', type: 'unknown' as InvestmentAsset['type'] })))
      .toBe('기타');
  });
});
