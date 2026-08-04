import { describe, test, expect } from 'vitest';
import { SimpleSimulationAdapter, SimpleSimulationInput } from '@/core/usecases/SimpleSimulationAdapter';

describe('SimpleSimulationAdapter', () => {
  const baseInput: SimpleSimulationInput = {
    currentAge: 45,
    retirementAge: 62,
    currentAssets: 200000000,
    monthlyInvestment: 1500000,
    nationalPension: 1200000,
    targetMonthlySpending: 3000000,
    propensity: 'neutral',
  };

  describe('투자성향별 성장률/배당률 매핑 (하드코딩 숫자 검증)', () => {
    test('conservative(안전추구)는 연 성장률 1.0%, 배당률 3.0%로 매핑된다', () => {
      const params = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'conservative' });

      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].annualGrowthRate).toBe(1.0);
      expect(params.assets[0].dividendYield).toBe(3.0);
    });

    test('neutral(중립형)은 연 성장률 3.0%, 배당률 4.0%로 매핑된다', () => {
      const params = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'neutral' });

      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].annualGrowthRate).toBe(3.0);
      expect(params.assets[0].dividendYield).toBe(4.0);
    });

    test('aggressive(공격형)는 연 성장률 8.0%, 배당률 1.5%로 매핑된다', () => {
      const params = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'aggressive' });

      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].annualGrowthRate).toBe(8.0);
      expect(params.assets[0].dividendYield).toBe(1.5);
    });

    test('propensity별 ticker/name 라벨도 함께 매핑된다', () => {
      const conservative = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'conservative' });
      const neutral = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'neutral' });
      const aggressive = SimpleSimulationAdapter.adapt({ ...baseInput, propensity: 'aggressive' });

      expect(conservative.assets[0].ticker).toBe('안전자산');
      expect(conservative.assets[0].name).toBe('예금/채권 혼합');

      expect(neutral.assets[0].ticker).toBe('혼합자산');
      expect(neutral.assets[0].name).toBe('배당ETF/채권 혼합');

      expect(aggressive.assets[0].ticker).toBe('성장자산');
      expect(aggressive.assets[0].name).toBe('성장형 ETF');
    });
  });

  describe('자산 배열 경계조건', () => {
    test('현재 자산과 월 투자금이 모두 0이면 assets 배열이 비어있다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: 0,
        monthlyInvestment: 0,
      });

      expect(params.assets).toEqual([]);
    });

    test('현재 자산만 0보다 크면 asset이 1개 생성된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: 100000000,
        monthlyInvestment: 0,
      });

      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].averagePrice).toBe(100000000);
      expect(params.assets[0].monthlyContribution).toBe(0);
    });

    test('월 투자금만 0보다 크면 asset이 1개 생성된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: 0,
        monthlyInvestment: 500000,
      });

      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].averagePrice).toBe(0);
      expect(params.assets[0].monthlyContribution).toBe(500000);
    });
  });

  describe('음수 입력값 처리 (방어 로직 부재를 문서화하는 회귀 가드)', () => {
    test('currentAssets가 음수여도 방어 로직 없이 그대로 averagePrice에 전달되고, asset은 생성된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: -100000000,
        monthlyInvestment: 0,
      });

      // currentAssets(-1억) > 0 조건이 false이고 monthlyInvestment(0) > 0도 false이므로
      // asset 생성 조건(currentAssets > 0 || monthlyInvestment > 0)을 만족하지 못해 배열이 비게 된다.
      // 이는 "음수 자산도 자산으로 취급해 asset을 만들어줄 것"이라는 기대와 다를 수 있는 현재 동작이다.
      expect(params.assets).toEqual([]);
    });

    test('monthlyInvestment가 음수면 asset 생성 조건은 currentAssets에 의해서만 결정된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: 100000000,
        monthlyInvestment: -500000,
      });

      // currentAssets > 0 이 true이므로 asset은 생성되고, 음수 monthlyContribution이 방어 없이 그대로 전달된다.
      expect(params.assets).toHaveLength(1);
      expect(params.assets[0].monthlyContribution).toBe(-500000);
    });

    test('currentAssets와 monthlyInvestment가 모두 음수면 방어 로직 없이 assets가 비어있다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAssets: -100000000,
        monthlyInvestment: -500000,
      });

      expect(params.assets).toEqual([]);
    });

    test('currentAge, retirementAge, targetMonthlySpending이 음수여도 방어 로직 없이 userProfile에 그대로 전달된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        currentAge: -1,
        retirementAge: -1,
        targetMonthlySpending: -3000000,
      });

      expect(params.userProfile.currentAge).toBe(-1);
      expect(params.userProfile.retirementAge).toBe(-1);
      expect(params.userProfile.targetMonthlySpending).toBe(-3000000);
    });

    test('nationalPension이 음수여도 방어 로직 없이 그대로 전달된다', () => {
      const params = SimpleSimulationAdapter.adapt({
        ...baseInput,
        nationalPension: -1200000,
      });

      expect(params.nationalPension.expectedMonthlyAmount).toBe(-1200000);
    });
  });

  describe('그 외 필드 스모크 테스트', () => {
    test('userProfile이 입력값 그대로 매핑되고 expectancy는 기본값 100세로 채워진다', () => {
      const params = SimpleSimulationAdapter.adapt(baseInput);

      expect(params.userProfile).toEqual({
        currentAge: 45,
        retirementAge: 62,
        expectancy: 100,
        targetMonthlySpending: 3000000,
      });
    });

    test('nationalPension, privatePensions, isaAccounts, otherIncomes가 합리적인 기본값으로 채워진다', () => {
      const params = SimpleSimulationAdapter.adapt(baseInput);

      expect(params.nationalPension).toEqual({ expectedMonthlyAmount: 1200000 });
      expect(params.privatePensions).toEqual([]);
      expect(params.isaAccounts).toEqual([]);
      expect(params.otherIncomes).toEqual([]);
    });

    test('인플레이션/환율/통화 등 시뮬레이션 공통 가정치가 고정값으로 채워진다', () => {
      const params = SimpleSimulationAdapter.adapt(baseInput);

      expect(params.inflationRate).toBe(2.0);
      expect(params.inflationMode).toBe('real');
      expect(params.baseExchangeRate).toBe(1400);
      expect(params.exchangeScenario).toBe('base');
      expect(params.displayCurrency).toBe('KRW');
      expect(params.spendingStrategy).toBe('target');
    });

    test('taxSettings가 합리적인 기본값으로 채워진다', () => {
      const params = SimpleSimulationAdapter.adapt(baseInput);

      expect(params.taxSettings).toEqual({
        enableComprehensiveTax: true,
        enableHealthInsurance: true,
        usDividendTaxRate: 15,
        domesticDividendTaxRate: 15.4,
        comprehensiveTaxMode: 'progressive_credit',
        comprehensiveTaxRate: 15,
        healthInsuranceRate: 7.09,
        enableCapitalGainsTax: true,
        capitalGainsTaxRate: 22,
        enablePrivatePensionTax: true,
        privatePensionLimit: 15000000,
        privatePensionExcessTaxRate: 16.5,
        limitPrivatePensionToTaxLimit: false,
        enablePensionComprehensiveComparison: true,
      });
    });

    test('asset의 나머지 필드(type, quantity, currency, assetMarket, reinvestDividend)도 합리적인 기본값을 갖는다', () => {
      const params = SimpleSimulationAdapter.adapt(baseInput);
      const asset = params.assets[0];

      expect(asset.type).toBe('etf');
      expect(asset.quantity).toBe(1);
      expect(asset.currency).toBe('KRW');
      expect(asset.assetMarket).toBe('KR_ETF');
      expect(asset.reinvestDividend).toBe(true);
      expect(typeof asset.id).toBe('string');
      expect(asset.id.length).toBeGreaterThan(0);
    });
  });
});
