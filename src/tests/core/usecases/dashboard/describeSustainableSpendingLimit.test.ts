import { describe, test, expect } from 'vitest';
import {
  describeSustainableSpendingLimit,
} from '@/core/usecases/dashboard/describeSustainableSpendingLimit';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams, SustainableSpendingFloorOverride } from '@/core/entities/types';

// **문장을 통째로 고정한다.** enum이나 boolean만 검사하면 문구가 조용히 바뀌어도 통과한다 —
// 이 저장소는 「1,000회 중 0회」를 enum 검사만으로 내보낸 적이 있다.
//
// 서식기는 화면·PDF와 «다른» 결정적 서식기를 쓴다. 여기서 검증하는 것은 문장의 «구성»이지
// 통화 표기가 아니고, 표기까지 묶으면 서식기를 손댈 때 이 파일이 통째로 흔들린다.
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

// 실측 픽스처(사적연금 5억·저율과세 한도 ON·60→70세)의 값.
const OVERRIDE: SustainableSpendingFloorOverride = {
  preferenceRespectingMonthly: 1_181_250,
  floorHonoringMonthly: 3_446_597,
  deliveredMonthly: 3_446_597,
  hardSpendingFloor: 2_500_000,
};

function notice(over: Partial<Parameters<typeof describeSustainableSpendingLimit>[0]> = {}) {
  return describeSustainableSpendingLimit({
    override: OVERRIDE,
    endingAssets: 5,
    depletionAge: null,
    expectancy: 70,
    formatValue: won,
    ...over,
  });
}

describe('1. 왜 인출이 늘었는지 — HARD 생활비를 우선한 결과임을 밝힌다', () => {
  test('탐색값에서 전달값으로 오른 폭과 그 이유를 한 문장으로 말한다', () => {
    expect(notice()!.reason).toBe(
      '설정한 생활비를 반드시 충족하도록 인출한 결과, 지속 가능한 생활비가 '
      + '월 1,181,250원에서 월 3,446,597원으로 올랐습니다. '
      + '「반드시 지키기」로 정한 월 2,500,000원이 세제 최적화·계좌 인출 순서·월 인출 목표보다 '
      + '우선하기 때문입니다.'
    );
  });

  test('제목도 이 함수가 정한다 — 화면과 PDF가 각자 제목을 적으면 문장과 어긋난다', () => {
    expect(notice()!.title).toBe('「반드시 지키기」로 정한 생활비를 우선한 한계 계획입니다');
  });

  // 바닥이 구속하지 않은 계획은 종전과 한 발도 다르지 않다. 설명할 것이 없으므로 «아무것도»
  // 그리지 않는다 — 빈 문자열이나 「해당 없음」을 내면 소비처마다 「비었다」 기준이 생긴다.
  test('바닥이 구속하지 않은 계획에는 고지 자체가 서지 않는다', () => {
    expect(notice({ override: undefined })).toBeUndefined();
  });
});

describe('3. 권장 소비액이 아니라 버틸 수 있는 한계값임을 밝힌다', () => {
  test('승인된 문구를 그대로 쓴다', () => {
    expect(notice()!.limit).toBe('이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.');
  });

  // 기말자산이 남든 고갈이 이르든, max_sustainable의 답은 언제나 「여기까지 버틸 수 있다」다.
  // 조건을 달면 잔액이 남는 계획에서 이 성격이 사라져 다시 권장액으로 읽힌다.
  test('잔여자산이 넉넉해도 이 문장은 빠지지 않는다', () => {
    expect(notice({ endingAssets: 500_000_000 })!.limit)
      .toBe('이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.');
  });
});

describe('2. 기말 잔여자산이 0이거나 매우 낮으면 경고한다', () => {
  test('표시상 0과 구별되지 않는 잔여자산에 경고가 뜬다', () => {
    expect(notice({ endingAssets: 5 })!.terminalAssets).toBe(
      '기대수명 70세 시점 잔여자산은 5원입니다. 예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.'
    );
  });

  test('정확히 0원인 계획에도 뜬다', () => {
    expect(notice({ endingAssets: 0 })!.terminalAssets).toBe(
      '기대수명 70세 시점 잔여자산은 0원입니다. 예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.'
    );
  });

  // 경계는 SHORTFALL_EPSILON_MONTHLY(1만원)다. 이 저장소의 유일한 금액 허용오차이자
  // formatManwon의 반올림 단위이므로, 이 선 아래는 화면에 「0만원」으로 찍힌다.
  test('경계 바로 위(1만원)에서는 뜨지 않는다', () => {
    expect(notice({ endingAssets: 10_000 })!.terminalAssets).toBeUndefined();
    expect(notice({ endingAssets: 9_999 })!.terminalAssets).toBeDefined();
  });

  test('잔여자산이 넉넉한 계획에서는 침묵한다', () => {
    expect(notice({ endingAssets: 500_000_000 })!.terminalAssets).toBeUndefined();
  });

  // 고갈한 계획의 endingAssets는 음수로 떨어질 수 있다. 「-3원 남았습니다」는 문장이 아니다.
  test('음수 잔액은 0원으로 말한다', () => {
    expect(notice({ endingAssets: -3 })!.terminalAssets).toBe(
      '기대수명 70세 시점 잔여자산은 0원입니다. 예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.'
    );
  });
});

describe('4. HARD 바닥 근처에서 고갈 여유가 매우 작으면 별도 위험 경고', () => {
  // 경계는 OVERSPENDING_RATIO(95%)다. 새 비율을 만들지 않고 같은 도메인이 이미 쓰는 폭을
  // 가져온다 — 그쪽도 「지속 가능한 한도 대 요구 생활비」의 비율이다.
  test('바닥이 한계의 95%에 닿으면 경고한다', () => {
    const tight = { ...OVERRIDE, hardSpendingFloor: 3_274_268 }; // 3,446,597 × 0.95 = 3,274,267.15
    expect(notice({ override: tight })!.depletionRisk).toBe(
      '「반드시 지키기」로 정한 월 3,274,268원이 이 계획이 감당하는 한계(월 3,446,597원)에 '
      + '거의 닿아 있습니다. 수익률이 조금만 낮아져도 기대수명 전에 자산이 바닥납니다.'
    );
  });

  test('바닥이 한계를 넘어 실제로 고갈하면 고갈 나이로 말한다', () => {
    const exceeded = {
      ...OVERRIDE,
      hardSpendingFloor: 5_000_000,
      deliveredMonthly: 5_000_000,
    };
    expect(notice({ override: exceeded, depletionAge: 67 })!.depletionRisk).toBe(
      '자산이 67세에 바닥나 기대수명 70세까지 버티지 못합니다. '
      + '「반드시 지키기」로 정한 월 5,000,000원이 이 계획이 감당하는 한계(월 3,446,597원)를 '
      + '넘기 때문입니다.'
    );
  });

  // 실측 픽스처의 바닥(250만)은 한계(344.7만)의 72.5%다. 여유가 있으므로 이 경고는 «없다» —
  // 인출이 늘었다는 사실(1번)과 위험(4번)은 다른 사건이고, 늘 함께 뜨면 4번이 정보를 잃는다.
  test('여유가 있으면 침묵한다', () => {
    expect(notice()!.depletionRisk).toBeUndefined();
  });

  test('경계 바로 아래에서는 뜨지 않는다', () => {
    const loose = { ...OVERRIDE, hardSpendingFloor: 3_274_267 };
    expect(notice({ override: loose })!.depletionRisk).toBeUndefined();
  });
});

// 위 문장들이 «실제 엔진 산출»에서 그대로 만들어지는지. 합성 override만 검사하면
// SimulationResult의 필드 이름이 바뀌는 날 이 파일만 조용히 통과한다.
describe('엔진 산출과 이어 붙인다', () => {
  function pensionCapped(over: Partial<SimulationParams> = {}): SimulationParams {
    return {
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 3_000_000 },
      assets: [], isaAccounts: [], otherIncomes: [],
      privatePensions: [{
        id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
        balance: 500_000_000, monthlyContribution: 0,
        totalReturn: 0, dividendYield: 0, currency: 'KRW',
      }],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      taxSettings: { limitPrivatePensionToTaxLimit: true },
      spendingStrategy: 'max_sustainable',
      ...over,
    } as unknown as SimulationParams;
  }

  function describeRun(params: SimulationParams) {
    const result = new SimulationEngine().run(params);
    return {
      result,
      notice: describeSustainableSpendingLimit({
        override: result.sustainableSpendingOverride,
        endingAssets: result.endingAssets,
        depletionAge: result.depletionAge,
        expectancy: params.userProfile.expectancy,
        formatValue: won,
      }),
    };
  }

  test('바닥 250만 계획 — 1·2·3번이 뜨고 4번은 뜨지 않는다', () => {
    const { result, notice: n } = describeRun(
      pensionCapped({ hardSpendingFloor: 2_500_000 } as Partial<SimulationParams>)
    );

    expect(Math.round(result.calculatedTargetSpending!)).toBe(3_446_597);
    expect(n!.reason).toBe(
      '설정한 생활비를 반드시 충족하도록 인출한 결과, 지속 가능한 생활비가 '
      + '월 1,181,250원에서 월 3,446,597원으로 올랐습니다. '
      + '「반드시 지키기」로 정한 월 2,500,000원이 세제 최적화·계좌 인출 순서·월 인출 목표보다 '
      + '우선하기 때문입니다.'
    );
    expect(n!.limit).toBe('이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.');
    expect(n!.terminalAssets).toBe(
      '기대수명 70세 시점 잔여자산은 5원입니다. 예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.'
    );
    expect(n!.depletionRisk).toBeUndefined();
  });

  test('바닥 500만 계획 — 바닥이 한계를 넘어 4번이 고갈 나이로 뜬다', () => {
    const { result, notice: n } = describeRun(
      pensionCapped({ hardSpendingFloor: 5_000_000 } as Partial<SimulationParams>)
    );

    expect(result.depletionAge).toBe(67);
    expect(n!.depletionRisk).toBe(
      '자산이 67세에 바닥나 기대수명 70세까지 버티지 못합니다. '
      + '「반드시 지키기」로 정한 월 5,000,000원이 이 계획이 감당하는 한계(월 3,446,597원)를 '
      + '넘기 때문입니다.'
    );
  });

  test('HARD 바닥이 없는 계획에는 네 문장이 «하나도» 뜨지 않는다', () => {
    const { result, notice: n } = describeRun(pensionCapped());

    expect(result.sustainableSpendingOverride).toBeUndefined();
    expect(n).toBeUndefined();
  });

  test('바닥이 지속가능액보다 낮아 구속하지 않으면 뜨지 않는다', () => {
    const { notice: n } = describeRun(
      pensionCapped({ hardSpendingFloor: 500_000 } as Partial<SimulationParams>)
    );

    expect(n).toBeUndefined();
  });
});
