import { describe, test, expect } from 'vitest';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DEFAULT_TAX_SETTINGS, resolveTaxSettings } from '@/core/usecases/tax/taxRates';
import { DEFAULT_HEALTHCARE } from '@/core/usecases/healthcare/defaultHealthcare';
import { resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { normalizeRetirementGoals } from '@/core/entities/retirementGoal';

// 저장 데이터는 손상되거나 낡은 채로 돌아온다. localStorage는 사용자가 직접 고칠 수 있고,
// E2EE 시나리오는 복호화된 JSON이 그대로 올라오며, 예전 버전이 쓴 필드는 지금 타입과 다르다.
// 그런데 로드 경계는 `as SimulationParams` 캐스팅뿐이라, 그 값이 검사 없이 엔진까지 갔다.
//
// **시나리오를 통째로 버리지 않는 것이 이 함수의 첫 번째 원칙이다.** 필드 하나가 깨졌다고
// initialParams로 되돌리면 사용자의 저장 계획이 조용히 사라진다. 필드 단위로 기본값을 채우고,
// 배열은 원소 단위로만 정제한다.

describe('normalizeSimulationParams', () => {
  test('정상 데이터는 값을 바꾸지 않는다', () => {
    expect(normalizeSimulationParams(structuredClone(initialParams))).toEqual(initialParams);
  });

  test('객체가 아니면 기본값을 돌려준다', () => {
    for (const raw of [null, undefined, 3, 'params', [1, 2]]) {
      expect(normalizeSimulationParams(raw)).toEqual(initialParams);
    }
  });

  // 알 수 없는 키를 남기는 것은 의도된 계약이다(localStore.test.ts의 레거시 키 테스트).
  // 지우면 아직 타입에 반영되지 않은 새 필드나 남의 버전이 쓴 값을 우리가 파괴하게 된다.
  test('타입에 없는 키는 건드리지 않고 그대로 둔다', () => {
    const result = normalizeSimulationParams({ ...structuredClone(initialParams), unknownKey: { a: 1 } });

    expect((result as unknown as Record<string, unknown>).unknownKey).toEqual({ a: 1 });
  });

  // 중첩 구조에도 같은 계약이 적용된다. 여기서 모르는 키를 지우면, TaxSettings에 필드를
  // 추가하고 검증기 등록을 잊는 순간 모든 사용자의 그 필드가 로드마다 삭제된다 —
  // E2EE라 서버에서 되살릴 수 없어 영구 손실이다.
  test('중첩 구조에서도 타입에 없는 키를 지우지 않는다', () => {
    const result = normalizeSimulationParams({
      ...structuredClone(initialParams),
      taxSettings: { enableComprehensiveTax: true, futureTaxField: 42 },
      withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST', futurePlanField: 'keep' },
    });

    expect((result.taxSettings as unknown as Record<string, unknown>).futureTaxField).toBe(42);
    expect((result.withdrawalPlan as unknown as Record<string, unknown>).futurePlanField).toBe('keep');
  });

  // **원칙 4.** 선택 필드는 값뿐 아니라 «키의 존재»가 데이터다 — RetirementModelAdapter가
  // hasOwn으로 「사용자가 이 항목을 설정한 적이 있는가」를 판정한다. 객체 리터럴은
  // `{ k: undefined }`도 키를 만들므로 toEqual로는 이 계약을 검사할 수 없다(toEqual은
  // undefined 프로퍼티를 무시한다). 그래서 키 집합을 직접 본다.
  test('없던 선택 키를 undefined 값으로 만들어 내지 않는다', () => {
    const raw = structuredClone(initialParams) as unknown as Record<string, unknown>;
    for (const key of ['assetFloor', 'cashYieldRate', 'spendingStrategy', 'taxLawVersion',
      'spendingCurve', 'withdrawalPlan', 'taxSettings', 'customYieldSnapshot',
      'healthcare', 'isaAccounts', 'strategy']) {
      delete raw[key];
    }
    delete (raw.userProfile as Record<string, unknown>).targetBequest;

    const result = normalizeSimulationParams(raw) as unknown as Record<string, unknown>;

    for (const key of ['assetFloor', 'cashYieldRate', 'spendingStrategy', 'taxLawVersion',
      'spendingCurve', 'withdrawalPlan', 'taxSettings', 'customYieldSnapshot',
      'healthcare', 'isaAccounts', 'strategy']) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(result.userProfile, 'targetBequest')).toBe(false);
  });

  test('있던 선택 키는 값이 깨져도 키를 유지한다', () => {
    const result = normalizeSimulationParams({
      ...structuredClone(initialParams),
      assetFloor: 'broken',
      userProfile: { ...initialParams.userProfile, targetBequest: 'broken' },
    }) as unknown as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(result, 'assetFloor')).toBe(true);
    expect(result.assetFloor).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.userProfile, 'targetBequest')).toBe(true);
  });

  describe('숫자 필드', () => {
    test('숫자가 아닌 값은 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: {
          currentAge: '50',
          retirementAge: null,
          expectancy: undefined,
          targetMonthlySpending: { amount: 100 },
        },
        inflationRate: 'NaN',
        baseExchangeRate: [],
      });

      expect(result.userProfile).toEqual(initialParams.userProfile);
      expect(result.inflationRate).toBe(initialParams.inflationRate);
      expect(result.baseExchangeRate).toBe(initialParams.baseExchangeRate);
    });

    // JSON.stringify가 NaN/Infinity를 null로 바꾸므로 저장 왕복으로는 생기지 않지만,
    // 서버 payload와 수동 편집은 이 경로를 지난다. 엔진에 들어가면 모든 후속 계산이 NaN이 된다.
    test('NaN과 Infinity는 유한한 기본값으로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationRate: Number.NaN,
        baseExchangeRate: Number.POSITIVE_INFINITY,
      });

      expect(result.inflationRate).toBe(initialParams.inflationRate);
      expect(result.baseExchangeRate).toBe(initialParams.baseExchangeRate);
    });

    test('0과 음수는 정상 입력이므로 그대로 둔다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationRate: -1,
        cashYieldRate: 0,
      });

      expect(result.inflationRate).toBe(-1);
      expect(result.cashYieldRate).toBe(0);
    });

    // 금액에는 0이 「없음」이라는 정상 상태지만, 나눗셈의 분모나 «주기»에는 그런 뜻이 없다.
    // 그 둘을 같은 규칙으로 통과시키면 오류 없이 계산이 망가진다.
    test('분모·주기 필드의 0은 금액과 달리 통과시키지 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        // 0이면 SimulationEngine.convertValue가 USD 자산을 전부 Infinity로 만든다.
        baseExchangeRate: 0,
        isaAccounts: [{
          id: 'isa-1', type: 'general', balance: 1000, monthlyContribution: 0,
          totalReturn: 5, dividendYield: 0, currency: 'KRW',
          // 0년 만기는 만기 처리가 매년 발동하는 뜻이 된다.
          maturityYears: 0,
        }],
      });

      expect(result.baseExchangeRate).toBe(initialParams.baseExchangeRate);
      expect(result.isaAccounts?.[0].maturityYears).toBe(3);
    });
  });

  // 나이는 금액이 아니라 «루프의 경계»다. SimulationEngine의 투영은
  // `expectancy - currentAge + 1`번 도는데 NaN과 0 이하만 막으므로, 큰 값이 통과하면
  // 오류 없이 수억 번을 돌아 탭이 멈춘다. 멈춘 탭은 아무 메시지도 남기지 않아 잘못된
  // 숫자보다 진단하기 어렵다.
  describe('나이', () => {
    test('사람의 나이로 성립하지 않는 값은 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, expectancy: 1e9 },
      });

      expect(result.userProfile.expectancy).toBe(initialParams.userProfile.expectancy);
    });

    // 120으로 «깎지» 않는다. 깎으면 사용자가 넣은 적 없는 기대수명이 계획에 남는다.
    test('상한을 넘으면 잘라내는 것이 아니라 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, expectancy: 500 },
      });

      expect(result.userProfile.expectancy).not.toBe(120);
      expect(result.userProfile.expectancy).toBe(initialParams.userProfile.expectancy);
    });

    test('경계값 1과 120은 정상 입력이다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, currentAge: 1, expectancy: 120 },
      });

      expect(result.userProfile.currentAge).toBe(1);
      expect(result.userProfile.expectancy).toBe(120);
    });

    // 0세 은퇴도 0세 기대수명도 뜻하는 바가 없다. 게다가 currentAge 0은 엔진의
    // totalYears 가드(<= 0)를 통과해 0세부터 시작하는 계획이 조용히 돌아간다.
    // 입력 경계(parseAge)와 목표 경계(normalizeTargetValue)가 이미 1을 쓴다.
    test.each([
      ['currentAge'],
      ['retirementAge'],
      ['expectancy'],
    ] as const)('%s 0은 성립하지 않으므로 기본값으로 되돌린다', (key) => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, [key]: 0 },
      });

      expect(result.userProfile[key]).toBe(initialParams.userProfile[key]);
    });

    test('음수도 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, currentAge: -5 },
      });

      expect(result.userProfile.currentAge).toBe(initialParams.userProfile.currentAge);
    });
  });

  describe('유니온 리터럴', () => {
    test('허용되지 않은 값은 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationMode: 'REAL',
        exchangeScenario: 'usd_moon',
        displayCurrency: 'JPY',
        yieldPreset: 'insane',
      });

      expect(result.inflationMode).toBe(initialParams.inflationMode);
      expect(result.exchangeScenario).toBe(initialParams.exchangeScenario);
      expect(result.displayCurrency).toBe(initialParams.displayCurrency);
      expect(result.yieldPreset).toBe(initialParams.yieldPreset);
    });
  });

  describe('배열', () => {
    test('배열이 아니면 빈 배열로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: { '0': { id: 'a' } },
        privatePensions: 'none',
        otherIncomes: null,
      });

      expect(result.assets).toEqual([]);
      expect(result.privatePensions).toEqual([]);
      expect(result.otherIncomes).toEqual([]);
    });

    test('객체가 아닌 원소만 걸러내고 나머지는 살린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [null, initialParams.assets[0], 'broken', initialParams.assets[1]],
      });

      expect(result.assets).toEqual(initialParams.assets);
    });

    // 금액을 지어내지 않는다. 깨진 숫자는 0으로 두어 없는 것과 같게 만들고, 원소 자체는
    // 남긴다 — 사용자가 화면에서 그 자산을 보고 직접 고칠 수 있어야 한다.
    test('원소의 깨진 숫자는 0으로 두고 원소는 남긴다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [{ ...initialParams.assets[0], quantity: '2000', totalReturn: null }],
      });

      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].quantity).toBe(0);
      expect(result.assets[0].totalReturn).toBe(0);
      expect(result.assets[0].name).toBe('KODEX 200');
    });

    test('원소의 잘못된 유니온 값은 안전한 기본값으로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [{ ...initialParams.assets[0], type: 'crypto', currency: 'BTC' }],
        privatePensions: [{ ...initialParams.privatePensions[0], type: 'unknown' }],
        isaAccounts: [{ id: 'isa-1', type: 'vip', balance: 1000, monthlyContribution: 0, totalReturn: 4, dividendYield: 0, currency: 'KRW', maturityYears: 3 }],
      });

      expect(result.assets[0].type).toBe('etf');
      expect(result.assets[0].currency).toBe('KRW');
      expect(result.privatePensions[0].type).toBe('savings');
      expect(result.isaAccounts?.[0].type).toBe('general');
    });

    test('id가 없는 원소에는 자리 기반 id를 채운다', () => {
      const { id: _dropped, ...withoutId } = initialParams.assets[0];
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [withoutId],
      });

      expect(result.assets[0].id).toBeTypeOf('string');
      expect(result.assets[0].id.length).toBeGreaterThan(0);
    });

    // 이 파일의 주석이 「0으로 채우면 안 된다」고 못 박은 두 필드다. 둘 다 0과 미지정이
    // 서로 다른 뜻이고, 그 차이가 곧바로 금액으로 나타난다.
    test('0과 미지정이 다른 금액 필드는 깨졌을 때 미지정으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: { ...initialParams.userProfile, targetBequest: 'broken' },
        assets: [{
          id: 'a1', type: 'etf', ticker: 'X', name: 'n', quantity: 10, averagePrice: 1000,
          totalReturn: 5, dividendYield: 1, monthlyContribution: 0,
          reinvestDividend: false, currency: 'KRW',
          acquisitionCostBasis: Number.NaN,
        }],
      });

      // 0으로 채우면 「상속하지 않고 다 쓴다」는 명시적 목표로 읽혀 채점 곡선이 바뀐다.
      expect(result.userProfile.targetBequest).toBeUndefined();
      // 0으로 채우면 평가액 전체가 양도차익이 되어 세금이 폭증한다.
      expect(result.assets[0].acquisitionCostBasis).toBeUndefined();
    });

    test('목표는 알 수 없는 종류만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        retirementGoals: [
          { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'SOFT' },
          { type: 'WORLD_DOMINATION', priority: 2, constraintType: 'SOFT' },
          { type: 'INHERITANCE', priority: 'first', constraintType: 'MAYBE' },
        ],
      });

      expect(result.retirementGoals?.map((goal) => goal.type))
        .toEqual(['ASSET_SURVIVAL', 'INHERITANCE']);
      // 깨진 constraintType은 더 약한 쪽('SOFT')으로 둔다 — 검증하지 못한 목표를 필수로
      // 올리면 그 목표를 못 지킨 후보가 전부 탈락한다.
      expect(result.retirementGoals?.[1].constraintType).toBe('SOFT');
      // priority가 깨졌으면 순서를 지어내지 않고 뒤로 보낸다. normalizeRetirementGoals가
      // 오름차순 정렬이므로 «큰» 값이 뒤다. index + 1을 쓰면 정반대로 최상위가 된다.
      expect(result.retirementGoals?.[0].priority).toBe(1);
      expect(result.retirementGoals?.[1].priority).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('깨진 priority는 유효한 목표를 제치지 않는다', () => {
      // 앞자리에 둔다 — index 기반 폴백이면 priority 1을 받아 뒤 목표를 모두 제친다.
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        retirementGoals: [
          { type: 'INHERITANCE', priority: null, constraintType: 'SOFT' },
          { type: 'ASSET_SURVIVAL', priority: 9, constraintType: 'SOFT' },
        ],
      });

      const sorted = normalizeRetirementGoals(result.retirementGoals ?? []);
      expect(sorted.map((goal) => goal.type)).toEqual(['ASSET_SURVIVAL', 'INHERITANCE']);
    });
  });

  describe('필수 하위 객체', () => {
    test('빠져 있으면 기본값으로 채우되 국민연금액은 지어내지 않는다', () => {
      const result = normalizeSimulationParams({ userProfile: initialParams.userProfile, assets: [] });

      // 물가·환율처럼 0이 무의미한 최상위 설정값만 initialParams를 쓴다(원칙 2의 예외).
      expect(result.inflationMode).toBe(initialParams.inflationMode);
      expect(result.privatePensions).toEqual([]);
      // 국민연금 «금액»은 그 예외가 아니다. initialParams의 월 120만원을 채우면 있지도 않은
      // 종신 연금을 지어내는 셈이고, 그것이 계획을 가장 크게 낙관 쪽으로 흔든다.
      expect(result.nationalPension).toEqual({ expectedMonthlyAmount: 0 });
      expect(initialParams.nationalPension.expectedMonthlyAmount).toBeGreaterThan(0);
    });
  });

  // 중첩 구조는 전부 optional이라 「빠져 있음」이 정상 상태다. 그래서 깨진 값은 값을
  // 지어내는 대신 그 키를 지우는 것이 맞다 — 각 소비처가 이미 미지정 기본값을 갖고 있다.
  describe('taxSettings', () => {
    test('깨진 항목만 지우고 나머지 설정은 지킨다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        taxSettings: {
          enableComprehensiveTax: 'yes',
          enableHealthInsurance: false,
          usDividendTaxRate: '15',
          domesticDividendTaxRate: 22,
          comprehensiveTaxMode: 'guess',
        },
      });

      expect(result.taxSettings).toEqual({
        enableHealthInsurance: false,
        domesticDividendTaxRate: 22,
      });
    });

    test('resolveTaxSettings가 지워진 항목을 기본값으로 메운다', () => {
      const params = normalizeSimulationParams({
        ...structuredClone(initialParams),
        taxSettings: { usDividendTaxRate: Number.NaN, domesticDividendTaxRate: 22 },
      });
      const resolved = resolveTaxSettings(params.taxSettings);

      expect(resolved.usDividendTaxRate).toBe(DEFAULT_TAX_SETTINGS.usDividendTaxRate);
      expect(resolved.domesticDividendTaxRate).toBe(22);
    });

    test('객체가 아니면 키 자체를 지운다', () => {
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), taxSettings: 'off' });

      expect(result.taxSettings).toBeUndefined();
    });
  });

  describe('withdrawalPlan', () => {
    test('깨진 항목만 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        withdrawalPlan: {
          accountWithdrawalPolicy: 'RANDOM_FIRST',
          assetSellOrderStrategy: 'high_dividend_first',
          nationalPensionStartAge: '65',
          monthlySpendingMultiplier: 1.2,
        },
      });

      expect(result.withdrawalPlan).toEqual({
        assetSellOrderStrategy: 'high_dividend_first',
        monthlySpendingMultiplier: 1.2,
      });
    });

    test('사용자 지정 인출 순서는 알 수 없는 항목만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        withdrawalPlan: {
          accountWithdrawalPolicy: 'CUSTOM',
          customWithdrawalOrder: ['ISA', 42, 'GENERAL', null],
        },
      });

      expect(result.withdrawalPlan?.customWithdrawalOrder).toEqual(['ISA', 'GENERAL']);
    });
  });

  describe('spendingCurve', () => {
    // 배수 길이 = 구간 길이 + 1이 무너지면 뒤쪽 나이의 배수가 undefined가 되어 그 해
    // 목표 생활비가 NaN이 된다. 길이 계약은 타입 주석이 명시한 것이지만 강제는 없었다.
    test('배수 길이가 맞지 않으면 곡선을 통째로 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        spendingCurve: { breakpointAges: [70, 80], multipliers: [1.2, 1] },
      });

      expect(result.spendingCurve).toBeUndefined();
    });

    test('숫자가 아닌 값이 섞여 있으면 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        spendingCurve: { breakpointAges: [70, '80'], multipliers: [1.2, 1, 0.8] },
      });

      expect(result.spendingCurve).toBeUndefined();
    });

    test('올바른 곡선은 그대로 둔다', () => {
      const curve = { breakpointAges: [70, 80], multipliers: [1.2, 1, 0.8] };
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), spendingCurve: curve });

      expect(result.spendingCurve).toEqual(curve);
    });
  });

  describe('customYieldSnapshot', () => {
    test('숫자가 아닌 항목만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        customYieldSnapshot: {
          assets: { 'asset-1': 7, 'asset-2': '9' },
          privatePensions: { 'pension-1': 4 },
          isaAccounts: 'none',
        },
      });

      expect(result.customYieldSnapshot).toEqual({
        assets: { 'asset-1': 7 },
        privatePensions: { 'pension-1': 4 },
        isaAccounts: {},
      });
    });
  });

  describe('예금형 계좌의 배당률', () => {
    // 예금형 ISA는 화면에 배당 입력칸이 없다(AssetFormSection의 investmentType 분기).
    // 그런데 신규 ISA의 기본 dividendYield가 1.5라, 유형만 예금으로 바꾸면 사용자가
    // 볼 수도 고칠 수도 없는 배당률이 계좌에 남는다. 총수익률 모델에서 그 값은 총합을
    // 늘리지는 못하지만, 가격상승분을 갉아먹고 배당소득으로 집계된다.
    test('예금형 ISA의 dividendYield를 0으로 지운다', () => {
      const params = normalizeSimulationParams({
        ...initialParams,
        isaAccounts: [{
          id: 'isa-1', type: 'general', investmentType: 'deposit',
          balance: 1_000_000, monthlyContribution: 0,
          totalReturn: 3, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
        }],
      });

      expect(params.isaAccounts?.[0].dividendYield).toBe(0);
      expect(params.isaAccounts?.[0].totalReturn).toBe(3);
    });

    test('예금형이 아니면 배당률을 그대로 둔다', () => {
      const params = normalizeSimulationParams({
        ...initialParams,
        isaAccounts: [{
          id: 'isa-1', type: 'general', investmentType: 'custom',
          balance: 1_000_000, monthlyContribution: 0,
          totalReturn: 7, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
        }],
      });

      expect(params.isaAccounts?.[0].dividendYield).toBe(1.5);
    });
  });

  describe('healthcare', () => {
    // enabled는 `!healthcare.enabled`로만 검사돼, 문자열 'false'가 의료비를 켰다.
    // costGrowthRate가 NaN이면 그 해 의료비가 NaN이 되고 자산 전체가 NaN으로 번진다.
    //
    // **enabled만 기본값으로 되돌리지 않는다.** 키가 있는데 boolean이 아니면 사용자가 이
    // 패널을 건드린 흔적이므로, 나머지 필드가 살아 있는 쪽(= 켜 둔 상태)을 택한다.
    // 반대로 두면(기본값 false) 읽지 못한 설정이 「끔」과 구별되지 않고, 의료비는 비용이라
    // 그 방향이 계획을 실제보다 안전해 보이게 만든다 — 월 30만원 + 80세 이후 월 150만원 +
    // 3,000만원 충격이 통째로 빠진다. 잘못 켜지는 쪽은 비관적으로 틀릴 뿐이다.
    test('깨진 항목을 기본값으로 되돌리되 의료비를 조용히 끄지는 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        healthcare: {
          enabled: 'true',
          costGrowthRate: Number.NaN,
          baseMonthlyCost: 400000,
          longTermCareEnabled: true,
          longTermCareStartAge: 80,
          longTermCareMonthlyCost: 1500000,
          shockEnabled: false,
          shockAge: 75,
          shockAmount: 30000000,
        },
      });

      // 'true'는 판별력이 있는 유일한 입력이다. DEFAULT_HEALTHCARE.enabled가 false라
      // 'false'를 쓰면 「기본값으로 되돌렸다」와 「truthy로 읽었다」가 같은 답을 낸다.
      expect(result.healthcare?.enabled).toBe(true);
      expect(DEFAULT_HEALTHCARE.enabled).toBe(false);
      expect(result.healthcare?.costGrowthRate).toBe(DEFAULT_HEALTHCARE.costGrowthRate);
      // 멀쩡한 사용자 입력은 지킨다.
      expect(result.healthcare?.baseMonthlyCost).toBe(400000);
      expect(result.healthcare?.longTermCareEnabled).toBe(true);
    });

    test('객체가 아니면 키 자체를 지운다', () => {
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), healthcare: true });

      expect(result.healthcare).toBeUndefined();
    });

    // 「지정한 적 없음」과 「읽지 못함」은 다르다. 키가 아예 없으면 사용자가 이 패널을
    // 건드린 적이 없다는 뜻이므로 제품 기본값(끔)이 맞다.
    test('enabled 키가 없으면 제품 기본값을 쓴다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        healthcare: { costGrowthRate: 5, baseMonthlyCost: 300000 },
      });

      expect(result.healthcare?.enabled).toBe(DEFAULT_HEALTHCARE.enabled);
    });
  });

  describe('strategy', () => {
    test('깨진 항목만 지우고 나머지 선택은 지킨다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: {
          mode: 'wizard',
          objective: 'tax_minimization',
          riskProfile: 42,
          bequestSafetyMarginRate: Number.NaN,
          minMonthlySpending: 2000000,
        },
      });

      expect(result.strategy).toEqual({
        objective: 'tax_minimization',
        minMonthlySpending: 2000000,
      });
    });

    // preferIsaFirst는 boolean이던 시절의 값이 실제로 저장돼 있고, resolveStrategy의
    // normalizeIsaFirstChoice가 그것을 3값 enum으로 옮긴다. E2EE라 서버 마이그레이션이
    // 불가능해 읽는 시점의 변환이 유일한 경로다 — 여기서 버리면 그 경로가 끊긴다.
    test('boolean으로 저장된 옛 preferIsaFirst를 버리지 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: { preferIsaFirst: false },
      });

      expect(result.strategy?.preferIsaFirst).toBe(false);
      expect(resolveStrategy(result).preferIsaFirst).toBe('pension_first');
    });

    // `strategy`의 «있음»과 «없음»은 서로 다른 상태다. 없으면 "전략을 저장한 적 없음"이고,
    // strategyFieldMap과 verifiedSentinelPlan이 그것을 판정에 쓴다. 내용이 전부 깨졌다고
    // 키를 지우면 저장한 적 있는 시나리오가 저장한 적 없는 것으로 바뀐다.
    test('내용이 전부 깨져도 저장했다는 사실 자체는 지운다고 없애지 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: { mode: 'wizard', riskProfile: null },
      });

      expect(result.strategy).toEqual({});
    });

    test('전략을 저장한 적 없으면 키를 만들지 않는다', () => {
      const result = normalizeSimulationParams(structuredClone(initialParams));

      expect(result.strategy).toBeUndefined();
      expect('strategy' in result).toBe(false);
    });
  });

  test('taxLawVersion은 알려진 값만 남긴다', () => {
    expect(normalizeSimulationParams({ ...structuredClone(initialParams), taxLawVersion: 'current' })
      .taxLawVersion).toBe('current');
    expect(normalizeSimulationParams({ ...structuredClone(initialParams), taxLawVersion: '2019' })
      .taxLawVersion).toBeUndefined();
  });

  // 정제의 목적은 형식이 아니라 「엔진이 NaN을 먹지 않는 것」이다.
  test('깨진 저장 데이터로도 시뮬레이션이 유한한 숫자를 낸다', () => {
    const params = normalizeSimulationParams({
      ...structuredClone(initialParams),
      userProfile: { currentAge: '50', retirementAge: 60, expectancy: 85, targetMonthlySpending: null },
      inflationRate: Number.NaN,
      assets: [{ ...initialParams.assets[0], quantity: 'many' }],
    });

    const result = new SimulationEngine().run(params);

    expect(result.yearlyResults.length).toBeGreaterThan(0);
    for (const year of result.yearlyResults) {
      expect(Number.isFinite(year.totalAssets)).toBe(true);
      expect(Number.isFinite(year.totalIncome)).toBe(true);
    }
  });
});
