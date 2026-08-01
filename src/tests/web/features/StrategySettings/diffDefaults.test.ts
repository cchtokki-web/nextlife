import { describe, test, expect } from 'vitest';
import { collectChangedPaths, countSectionChanges } from '@/web/features/StrategySettings/diffDefaults';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

describe('collectChangedPaths', () => {
  test('기본값 그대로면 변경된 경로가 없다', () => {
    expect(collectChangedPaths(initialParams).size).toBe(0);
  });

  test('현재 나이를 바꾸면 그 경로만 변경으로 잡힌다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42 },
    };

    const changed = collectChangedPaths(params);

    expect(changed.has('userProfile.currentAge')).toBe(true);
    expect(changed.has('userProfile.retirementAge')).toBe(false);
  });

  test('전략이 기본 전략과 같으면 변경으로 잡지 않는다', () => {
    const params = { ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY } };

    expect(collectChangedPaths(params).size).toBe(0);
  });

  test('전략 하위 필드를 바꾸면 strategy.* 경로가 잡힌다', () => {
    const params = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'tax_minimization' as const },
    };

    expect(collectChangedPaths(params).has('strategy.objective')).toBe(true);
  });

  // 최신 환율 자동 조회는 「경제 가정」을 열 때마다 baseExchangeRate를 실시간 값으로
  // 덮어쓴다. 그것까지 "사용자 설정"으로 세면, 사용자가 손대지 않았는데 손댄 것처럼
  // 배지가 붙는다(간편 모드에서는 "숨겨진 사용자 설정 1개"로 나타난다).
  describe('자동 조회된 환율은 사용자 변경으로 세지 않는다', () => {
    test('자동 조회가 켜져 있으면 환율이 달라도 변경으로 잡지 않는다', () => {
      const params = { ...initialParams, baseExchangeRate: 1478.3 };

      const changed = collectChangedPaths(params);

      expect(changed.has('baseExchangeRate')).toBe(false);
      expect(changed.has('useLatestExchangeRate')).toBe(false);
    });

    test('껐다가 다시 켜서 명시적 true가 되어도 변경으로 잡지 않는다', () => {
      // 기준값은 undefined(=켜짐)라 명시적 true와 값이 다르지만 동작은 기본과 같다.
      const params = { ...initialParams, useLatestExchangeRate: true, baseExchangeRate: 1478.3 };

      const changed = collectChangedPaths(params);

      expect(changed.has('useLatestExchangeRate')).toBe(false);
      expect(changed.has('baseExchangeRate')).toBe(false);
    });

    test('자동 조회를 끄면 그때부터 환율 변경이 사용자 설정으로 잡힌다', () => {
      const params = {
        ...initialParams,
        useLatestExchangeRate: false,
        baseExchangeRate: 1478.3,
      };

      const changed = collectChangedPaths(params);

      expect(changed.has('baseExchangeRate')).toBe(true);
      // 자동 조회를 끈 것 자체도 사용자의 선택이다.
      expect(changed.has('useLatestExchangeRate')).toBe(true);
    });

    test('자동 조회를 꺼도 환율이 기본값 그대로면 환율은 변경이 아니다', () => {
      const params = { ...initialParams, useLatestExchangeRate: false };

      const changed = collectChangedPaths(params);

      expect(changed.has('baseExchangeRate')).toBe(false);
      expect(changed.has('useLatestExchangeRate')).toBe(true);
    });
  });

  test('taxSettings를 기본값과 다르게 주면 해당 경로가 잡힌다', () => {
    const params = { ...initialParams, taxSettings: { ...initialParams.taxSettings, usDividendTaxRate: 20 } as never };

    expect(collectChangedPaths(params).has('taxSettings.usDividendTaxRate')).toBe(true);
  });

  test('저율과세 한도 내 인출을 켜면 변경으로 잡힌다', () => {
    const params = {
      ...initialParams,
      taxSettings: { ...initialParams.taxSettings, limitPrivatePensionToTaxLimit: true } as never,
    };

    expect(collectChangedPaths(params).has('taxSettings.limitPrivatePensionToTaxLimit')).toBe(true);
  });

  // B6: AdvancedSection은 지배 중일 때 저장값이 아니라 전략이 강제하는 실효값을 보여준다.
  // 배지만 저장값으로 판정하면, 스위치는 ON인데 "사용자 설정" 배지가 붙고 그 배지가 가리키는
  // OFF 값은 화면 어디에도 없는 상태가 된다. 최신 환율 자동 조회(baseExchangeRate)에
  // 이미 쓰고 있는 정책 — "사용자가 정한 값이 아니면 변경으로 세지 않는다" — 과 같다.
  describe('연금 전략이 저율과세 한도를 지배할 때', () => {
    const stored = (privatePensionStrategy: 'ai_optimized' | 'spending_first') => ({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy },
      taxSettings: { ...initialParams.taxSettings, limitPrivatePensionToTaxLimit: true } as never,
    });

    test('지배 중이면 저장값이 기본과 달라도 변경으로 세지 않는다', () => {
      expect(collectChangedPaths(stored('spending_first'))
        .has('taxSettings.limitPrivatePensionToTaxLimit')).toBe(false);
    });

    test('지배하지 않으면(AI 최적화) 평소대로 변경으로 잡는다', () => {
      expect(collectChangedPaths(stored('ai_optimized'))
        .has('taxSettings.limitPrivatePensionToTaxLimit')).toBe(true);
    });
  });
});

describe('countSectionChanges', () => {
  test('보이는 변경과 숨겨진 변경을 모드 기준으로 나눈다', () => {
    const changed = new Set(['userProfile.currentAge', 'taxSettings.usDividendTaxRate']);

    // 간편 모드: currentAge는 basic 섹션에서 보이고, 세율은 advanced라 숨겨진다.
    expect(countSectionChanges(changed, 'basic', 'simple')).toEqual({ visible: 1, hidden: 0 });
    expect(countSectionChanges(changed, 'advanced', 'simple')).toEqual({ visible: 0, hidden: 1 });

    // 전문가 모드: 둘 다 보인다.
    expect(countSectionChanges(changed, 'advanced', 'expert')).toEqual({ visible: 1, hidden: 0 });
  });

  test('변경이 없으면 0을 반환한다', () => {
    expect(countSectionChanges(new Set(), 'goal', 'standard')).toEqual({ visible: 0, hidden: 0 });
  });
});
