import { describe, expect, test } from 'vitest';
import { describeReturnOrigin, resolveReturnProvenance } from '@/core/usecases/returns/returnProvenance';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { SimulationParams } from '@/core/entities/types';

const asset = (id: string, totalReturn: number) => ({
  id, type: 'etf' as const, ticker: id, name: id,
  quantity: 100, averagePrice: 10_000, totalReturn, dividendYield: 1,
  monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' as const,
});
const isa = (id: string, totalReturn: number) => ({
  id, type: 'general' as const, balance: 10_000_000, monthlyContribution: 0,
  totalReturn, dividendYield: 1, currency: 'KRW' as const, maturityYears: 3,
});
const pension = (id: string, totalReturn: number) => ({
  id, type: 'irp' as const, balance: 10_000_000,
  monthlyContribution: 0, totalReturn, dividendYield: 0, currency: 'KRW' as const,
});

const build = (over: Partial<SimulationParams>): SimulationParams => ({
  ...structuredClone(initialParams),
  assets: [], isaAccounts: [], privatePensions: [],
  ...over,
} as SimulationParams);

const only = (params: SimulationParams) => resolveReturnProvenance(params).accounts[0];

describe('origin — 무엇을 주장할 수 있는가', () => {
  // 보관된 값과 «다르»면서 프리셋 값과 «같다». 프리셋이 사용자 값을 덮었다는 강한 증거다.
  test('보관값과 다르고 프리셋 값과 같으면 preset이다', () => {
    const account = only(build({
      assets: [asset('a1', 7)],
      customYieldSnapshot: { assets: { a1: 9 }, privatePensions: {} },
    }));

    expect(account.matchesPreset).toBe('base');
    expect(account.snapshot).toBe(9);
    expect(account.origin).toBe('preset');
  });

  // **프리셋 값은 사용자가 직접 타이핑해도 이상하지 않은 둥근 숫자다.** 값이 같다는 사실만으로
  // 프리셋이 채웠다고 말하면, 7%를 손으로 넣은 사용자에게 「프리셋으로 설정됨」이라고 거짓말한다.
  test('프리셋 값과 같지만 보관값이 없으면 단정하지 않는다', () => {
    expect(only(build({ assets: [asset('a1', 7)] })).origin).toBe('indeterminate');
  });

  // 스냅샷은 직접입력의 증거가 «못 된다» — applyYieldPreset이 스냅샷이 없을 때 지금 값을
  // 최초 1회 캡처하므로, 프리셋 상태로 시작한 계획에서는 스냅샷이 프리셋 값을 담는다.
  test('보관값이 지금 값과 같으면 단정하지 않는다', () => {
    const account = only(build({
      assets: [asset('a1', 7)],
      customYieldSnapshot: { assets: { a1: 7 }, privatePensions: {} },
    }));

    expect(account.origin).toBe('indeterminate');
  });

  test('어느 프리셋과도 다르면 direct_input이다', () => {
    const account = only(build({ assets: [asset('a1', 8.3)] }));

    expect(account.matchesPreset).toBeNull();
    expect(account.origin).toBe('direct_input');
  });
});

describe('계좌 종류별 프리셋 분업', () => {
  // applyYieldPreset은 일반자산·ISA에 stockGrowth(5/7/9), 사적연금에 pensionReturn(3/4/6)을
  // 쓴다. 여기서 갈라지면 프리셋을 누른 «직후»에도 「프리셋과 다르다」고 말하게 된다.
  test('사적연금은 pensionReturn과 견준다', () => {
    const provenance = resolveReturnProvenance(build({ privatePensions: [pension('p1', 4)] }));

    expect(provenance.accounts[0].matchesPreset).toBe('base');
  });

  test('사적연금에 주식 프리셋 값이 들어 있으면 어느 프리셋과도 맞지 않는다', () => {
    // 7은 stockGrowth의 base이지 pensionReturn의 값이 아니다.
    const provenance = resolveReturnProvenance(build({ privatePensions: [pension('p1', 7)] }));

    expect(provenance.accounts[0].matchesPreset).toBeNull();
  });

  test('ISA는 주식과 같은 stockGrowth와 견준다', () => {
    const provenance = resolveReturnProvenance(build({ isaAccounts: [isa('i1', 9)] }));

    expect(provenance.accounts[0].matchesPreset).toBe('aggressive');
  });

  test('ISA 키가 없는 옛 스냅샷에서도 터지지 않고 null을 낸다', () => {
    const provenance = resolveReturnProvenance(build({
      isaAccounts: [isa('i1', 7)],
      customYieldSnapshot: { assets: {}, privatePensions: {} },
    }));

    expect(provenance.accounts[0].snapshot).toBeNull();
  });
});

describe('scenario-adjusted', () => {
  // 민감도 3행·robustness 사본이 이 계좌에 «무엇을 넣었는지»를 같은 구조에서 읽는다.
  test('사본을 주면 계좌별 조정값을 id로 맞춰 싣는다', () => {
    const params = build({ assets: [asset('a1', 8.3), asset('a2', 4)] });
    const adjusted = build({ assets: [asset('a1', 5), asset('a2', 5)] });

    const { accounts } = resolveReturnProvenance(params, { adjusted });

    expect(accounts.map((a) => a.effective)).toEqual([8.3, 4]);
    expect(accounts.map((a) => a.adjusted)).toEqual([5, 5]);
  });

  test('사본이 없으면 adjusted는 0이 아니라 null이다', () => {
    expect(only(build({ assets: [asset('a1', 8.3)] })).adjusted).toBeNull();
  });
});

describe('저장된 yieldPreset의 어긋남', () => {
  // 저장 계층이 키 없는 시나리오에 'base'를 채워 넣는다(normalizeSimulationParams). 그러면
  // 누른 적 없는 프리셋이 선택된 것처럼 보인다. 그 어긋남 «자체»를 사실로 드러낸다.
  test('저장 키가 실제 수익률과 다르면 misleading이다', () => {
    const provenance = resolveReturnProvenance(build({
      assets: [asset('a1', 8.3)], yieldPreset: 'base',
    }));

    expect(provenance.portfolioPreset).toBeNull();
    expect(provenance.storedPreset).toBe('base');
    expect(provenance.storedPresetMisleading).toBe(true);
  });

  test('저장 키와 실제 수익률이 맞으면 misleading이 아니다', () => {
    const provenance = resolveReturnProvenance(build({
      assets: [asset('a1', 7)], privatePensions: [pension('p1', 4)], yieldPreset: 'base',
    }));

    expect(provenance.portfolioPreset).toBe('base');
    expect(provenance.storedPresetMisleading).toBe(false);
  });

  test("'custom'은 어긋남으로 세지 않는다 — 프리셋을 주장하지 않는 값이다", () => {
    const provenance = resolveReturnProvenance(build({
      assets: [asset('a1', 8.3)], yieldPreset: 'custom',
    }));

    expect(provenance.storedPresetMisleading).toBe(false);
  });
});

describe('포트폴리오 집계', () => {
  test('잔액가중 평균을 함께 낸다', () => {
    // 자산 100주×10,000원 = 100만원 @ 8%, ISA 1,000만원 @ 3%
    const provenance = resolveReturnProvenance(build({
      assets: [asset('a1', 8)], isaAccounts: [isa('i1', 3)],
    }));

    expect(provenance.weightedAverage).toBeCloseTo((1_000_000 * 8 + 10_000_000 * 3) / 11_000_000, 6);
  });

  test('굴릴 잔액이 없으면 0이 아니라 null이다', () => {
    expect(resolveReturnProvenance(build({})).weightedAverage).toBeNull();
  });

  test('세 종류 계좌를 모두 모은다', () => {
    const provenance = resolveReturnProvenance(build({
      assets: [asset('a1', 8)], isaAccounts: [isa('i1', 3)], privatePensions: [pension('p1', 4)],
    }));

    expect(provenance.accounts.map((a) => a.kind)).toEqual(['asset', 'isaAccount', 'privatePension']);
  });
});

describe('describeReturnOrigin — 말할 것이 있을 때만 말한다', () => {
  const describeFirst = (params: SimulationParams) => {
    const provenance = resolveReturnProvenance(params);
    return describeReturnOrigin(provenance.accounts[0], provenance);
  };

  test('프리셋이 사용자 값을 덮었으면 되돌릴 값을 함께 밝힌다', () => {
    expect(describeFirst(build({
      assets: [asset('a1', 7)],
      customYieldSnapshot: { assets: { a1: 9 }, privatePensions: {} },
    }))).toBe('중립 프리셋으로 채워진 값이며, 직접 입력했던 9%는 되돌릴 수 있게 보관되어 있습니다.');
  });

  // **소음 방지가 이 함수의 절반이다.** 프리셋 수익률은 손으로 넣어도 이상하지 않은 둥근
  // 숫자라, 값이 같다는 사실만으로 계좌마다 주석을 달면 프리셋을 누른 적 없는 계획의 거의
  // 모든 줄에 서로 다른 프리셋 이름이 붙는다.
  test('포트폴리오가 그 프리셋과 맞지 않으면 한 계좌의 우연은 말하지 않는다', () => {
    // 자산 5%(보수적)와 8%(어느 것도 아님)가 섞여 있어 포트폴리오는 어느 프리셋도 아니다.
    expect(describeFirst(build({ assets: [asset('a1', 5), asset('a2', 8)] }))).toBeNull();
  });

  test('포트폴리오 전체가 한 프리셋과 일치하면 단정하지 않고 사실만 말한다', () => {
    const note = describeFirst(build({
      assets: [asset('a1', 7), asset('a2', 7)], privatePensions: [pension('p1', 4)],
    }));

    expect(note).toBe('중립 프리셋과 같은 값입니다.');
    // 「설정됨」이라고 «단정하지 않는다» — 사용자가 7을 직접 넣었을 수도 있다.
    expect(note).not.toContain('채워진');
  });

  test('어느 프리셋과도 다르면 아무 말도 하지 않는다', () => {
    expect(describeFirst(build({ assets: [asset('a1', 8.3)] }))).toBeNull();
  });
});

