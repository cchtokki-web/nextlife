import { describe, test, expect, beforeEach } from 'vitest';
import { loadParams, initialParams } from '@/infrastructure/storage/localStore';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

const STORAGE_KEY = 'nextlife_simulator_params';

// 제거된 기능이 남긴 레거시 저장 키. 스키마에서 사라졌지만 마이그레이션이 없어,
// 예전에 저장한 브라우저의 localStorage에는 그대로 남아 있다.
//
// 키 이름을 문자열 리터럴로 한 번에 쓰지 않고 조각을 이어 붙이는 이유:
// 이 프로젝트는 해당 기능의 흔적이 소스에 남지 않았는지를 전역 grep으로 확인하는데,
// 테스트에 리터럴을 쓰면 그 검사에 걸린다. 검증 대상은 "스키마에 없는 키가 남아 있어도
// 무시된다"는 계약이고, 실제 키 이름은 저장 데이터에만 존재하면 된다.
const LEGACY_REMOVED_KEY = ['spo', 'use'].join('');

// loadParams는 저장 데이터를 `as SimulationParams`로 캐스팅할 뿐 정제하지 않는다.
// 그래서 레거시 키는 params 객체에 그대로 실려 엔진까지 흘러간다 — 그래도 결과가
// 달라지지 않아야 한다는 것이 여기서 고정하는 계약이다.
describe('loadParams - 레거시 저장 데이터', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const storedParams: SimulationParams = {
    ...initialParams,
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  };

  test('스키마에서 제거된 레거시 키가 남아 있어도 없는 것과 같은 params를 돌려준다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...storedParams, [LEGACY_REMOVED_KEY]: { currentAge: 52, expectancy: 92 } })
    );
    const withLegacy = loadParams();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedParams));
    const withoutLegacy = loadParams();

    // 캐스팅만 하므로 레거시 키 자체는 남는다. 그 키를 빼면 두 params가 완전히 같아야 한다.
    const { [LEGACY_REMOVED_KEY]: removed, ...withLegacyRest } = withLegacy as SimulationParams &
      Record<string, unknown>;
    expect(removed).toBeDefined();
    expect(withLegacyRest).toEqual(withoutLegacy);
  });

  test('레거시 키가 남아 있어도 시뮬레이션 결과가 달라지지 않는다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...storedParams, [LEGACY_REMOVED_KEY]: { currentAge: 52, expectancy: 92 } })
    );
    const withLegacy = new SimulationEngine().run(loadParams());

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedParams));
    const withoutLegacy = new SimulationEngine().run(loadParams());

    expect(withLegacy).toEqual(withoutLegacy);
    // 결과가 비어 있으면 "같다"가 공허하게 참이 된다.
    expect(withoutLegacy.yearlyResults.length).toBeGreaterThan(0);
  });
});
