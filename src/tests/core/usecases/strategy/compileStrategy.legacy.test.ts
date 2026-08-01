import { describe, test, expect } from 'vitest';
import {
  compileStrategy, DEFAULT_RETIREMENT_STRATEGY, resolveStrategy,
} from '@/core/usecases/strategy/compileStrategy';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 전략 컴파일러 이전에 출시되어 있던 저수준 필드(spendingStrategy / userProfile.targetBequest)를
// 저장해 둔 시나리오가, 마이그레이션 없이 열렸을 때 조용히 무효화되지 않는지 검증한다.
//
// 두 가지가 함께 지켜져야 한다:
//   1) 화면이 저장된 값을 그대로 보여준다(resolveStrategy)
//   2) 아무 필드나 한 번 건드려 params.strategy가 만들어져도 엔진 결과가 바뀌지 않는다
//      (StrategySettingsPanel의 모드 셀렉터를 포함한 모든 편집 경로가 resolveStrategy의
//       결과를 그대로 저장하기 때문에, 이 두 번째 불변식이 실제 사용자 시나리오다)
const legacyBase: SimulationParams = {
  userProfile: {
    currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000,
  },
  assets: [
    {
      id: 'a1', name: '국내 ETF', ticker: 'KODEX', type: 'etf', assetMarket: 'KR_ETF', currency: 'KRW',
      quantity: 10000, averagePrice: 50000, monthlyContribution: 500000,
      annualGrowthRate: 6, dividendYield: 2, reinvestDividend: true,
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'p1', name: '연금저축', type: 'savings', currency: 'KRW', balance: 100000000,
      monthlyContribution: 300000, annualReturn: 5, investmentType: 'custom', dividendYield: 0,
    },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const engine = new SimulationEngine();

describe('레거시 저수준 필드에서의 전략 유도(resolveStrategy)', () => {
  test('spendingStrategy = dividend_only 를 spendingChoice로 읽어온다', () => {
    const params: SimulationParams = { ...legacyBase, spendingStrategy: 'dividend_only' };

    expect(resolveStrategy(params).spendingChoice).toBe('dividend_only');
  });

  test('spendingStrategy = max_sustainable 를 spendingChoice로 읽어온다', () => {
    const params: SimulationParams = { ...legacyBase, spendingStrategy: 'max_sustainable' };

    expect(resolveStrategy(params).spendingChoice).toBe('max_sustainable');
  });

  test('spendingStrategy가 없으면 baseline인 target이다', () => {
    expect(resolveStrategy(legacyBase).spendingChoice).toBe('target');
  });

  test('targetBequest > 0 이면 상속 전략을 "목표 금액 유지"로 읽어온다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      userProfile: { ...legacyBase.userProfile, targetBequest: 500000000 },
    };

    expect(resolveStrategy(params).bequestStrategy).toBe('target_amount');
  });

  test('targetBequest === 0 이면 상속 전략을 "모두 사용"으로 읽어온다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      userProfile: { ...legacyBase.userProfile, targetBequest: 0 },
    };

    expect(resolveStrategy(params).bequestStrategy).toBe('spend_all');
  });

  // baseline은 '일부 남기기'다. '최대 상속'은 "많이 남길수록 가점"이라는 실제 채점 의미를
  // 가지므로 무동작 기본값으로 쓸 수 없다(compileStrategy의 DEFAULT_RETIREMENT_STRATEGY 주석).
  // '일부 남기기'가 채우는 targetBequest(월생활비 * 24)는 미지정일 때 UtilityEngine이 쓰는
  // 추정식과 같은 값이라 채점 결과가 바뀌지 않는다 — 아래 "엔진 결과 동일성"이 이를 건다.
  test('targetBequest 미설정이면 baseline인 "일부 남기기"다', () => {
    expect(resolveStrategy(legacyBase).bequestStrategy).toBe('leave_some');
  });

  test('명시적으로 저장된 strategy가 레거시 유도값을 이긴다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      spendingStrategy: 'dividend_only',
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'target' },
    };

    // 사용자가 새 UI에서 직접 'target'을 고른 상태다. 레거시 필드로 되돌리면 그 선택이 무시된다.
    expect(resolveStrategy(params).spendingChoice).toBe('target');
  });
});

describe('레거시 시나리오의 엔진 결과 불변성', () => {
  test('spendingStrategy를 저장해 둔 시나리오는 컴파일해도 결과가 같다', () => {
    const params: SimulationParams = { ...legacyBase, spendingStrategy: 'dividend_only' };

    expect(compileStrategy(params).params.spendingStrategy).toBe('dividend_only');
    expect(engine.run(compileStrategy(params).params)).toEqual(engine.run(params));
  });

  // 실제 회귀 경로: 사용자가 설정 패널에서 모드 셀렉터 등 아무 필드나 한 번 건드리면
  // params.strategy가 resolveStrategy의 결과로 materialize된다. 그 직후의 컴파일 결과가
  // 손대기 전과 달라지면, 저장해 둔 전략이 소리 없이 뒤집힌 것이다.
  test('패널이 strategy를 materialize한 뒤에도 엔진 결과가 손대기 전과 같다 (spendingStrategy)', () => {
    const params: SimulationParams = { ...legacyBase, spendingStrategy: 'dividend_only' };
    const touched: SimulationParams = { ...params, strategy: resolveStrategy(params) };

    expect(engine.run(compileStrategy(touched).params)).toEqual(engine.run(params));
  });

  test('패널이 strategy를 materialize한 뒤에도 targetBequest가 유지된다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      userProfile: { ...legacyBase.userProfile, targetBequest: 500000000 },
    };
    const touched: SimulationParams = { ...params, strategy: resolveStrategy(params) };

    expect(compileStrategy(touched).params.userProfile.targetBequest).toBe(500000000);
  });

  test('패널이 strategy를 materialize한 뒤에도 targetBequest 0(모두 사용)이 유지된다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      userProfile: { ...legacyBase.userProfile, targetBequest: 0 },
    };
    const touched: SimulationParams = { ...params, strategy: resolveStrategy(params) };

    expect(compileStrategy(touched).params.userProfile.targetBequest).toBe(0);
  });
});

// 이 브랜치 최대의 안전 주장 — "기능을 모두 끈 상태 = 작업 전과 완전히 동일" — 을 직접 건다.
describe('기본 전략(DEFAULT_RETIREMENT_STRATEGY)의 엔진 결과 동일성', () => {
  test('기본 전략으로 컴파일한 결과가 전략 없이 돌린 결과와 완전히 같다', () => {
    const compiled = compileStrategy({ ...legacyBase, strategy: DEFAULT_RETIREMENT_STRATEGY });

    expect(engine.run(compiled.params)).toEqual(engine.run(legacyBase));
  });

  test('배우자·의료비를 켜지 않은 시나리오에서도 동일하다', () => {
    const params: SimulationParams = {
      ...legacyBase,
      inflationMode: 'nominal',
      isaAccounts: [],
    };
    const compiled = compileStrategy({ ...params, strategy: DEFAULT_RETIREMENT_STRATEGY });

    expect(engine.run(compiled.params)).toEqual(engine.run(params));
  });
});
