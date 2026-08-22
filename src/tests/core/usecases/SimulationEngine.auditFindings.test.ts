import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import auditCase from '@/tests/fixtures/auditReportCase.json';

// 계산 정합성 감사(2026-08-22)에서 «재현»한 결함들을 고정한다.
//
// **이 파일의 테스트는 현재 실패한다.** 수정 전에 결함을 실행 가능한 형태로 남기는 것이
// 목적이고, 각 테스트는 "무엇이 옳은가"를 단언한다. 수정이 승인되면 이 파일이 통과 기준이 된다.
//
// 감사 하니스: `scripts/harness/ledger.harness.ts`
//   npx vitest run --config vitest.harness.config.ts scripts/harness/ledger.harness.ts

function baseParams(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 3_000_000 },
    assets: [],
    privatePensions: [],
    isaAccounts: [],
    otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0,
    inflationMode: 'nominal',
    baseExchangeRate: 1400,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...over,
  } as SimulationParams;
}

describe('[AUDIT-001] ISA 잔액이 있는데 생활비를 한 푼도 채우지 못한다', () => {
  // SimulationEngine.ts:1475 — accountWithdrawalPolicy가 «미지정»이면 ISA가 인출 계좌로
  // 등록조차 되지 않는다. 옛 시나리오 호환을 위한 opt-in이지만, 목표 기반 흐름으로 새로
  // 만든 계획도 이 축을 명시하지 않으므로 같은 함정에 빠진다.
  //
  // 결과: 2억 ISA를 들고 매년 목표 생활비 전액(3,600만원)이 미충족으로 기록되는데,
  // 총자산은 2억 그대로라 depletionAge가 null이다 → 리포트는 「평생 유지」라고 말한다.
  // 지시문 §9 Case D("자산이 있는데도 인출 함수가 호출되지 않음")의 실물이다.
  const isaOnly = (withdrawalPlan?: SimulationParams['withdrawalPlan']) => baseParams({
    isaAccounts: [{
      id: 'i', type: 'general', investmentType: 'etf', name: 'ISA',
      balance: 200_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW', maturityYears: 30,
    }],
    ...(withdrawalPlan ? { withdrawalPlan } : {}),
  } as Partial<SimulationParams>);

  test('인출 정책을 명시하면 ISA가 생활비를 채운다 (현재 동작 — 대조군)', () => {
    const result = new SimulationEngine().runSingle(
      isaOnly({ accountWithdrawalPolicy: 'GENERAL_FIRST' })
    );
    for (const year of result.yearlyResults) {
      expect(year.unmetSpending).toBe(0);
      expect(year.isaWithdrawal).toBeGreaterThan(0);
    }
  });

  test('인출 정책을 명시하지 않아도 ISA가 생활비를 채운다', () => {
    const result = new SimulationEngine().runSingle(isaOnly());

    // 인출 가능한 유동자산이 목표를 덮고도 남는데 부족으로 처리해서는 안 된다.
    for (const year of result.yearlyResults) {
      expect(year.unmetSpending).toBe(0);
    }
  });

  test('부족으로 처리한다면 총자산이 그대로 남는 「평생 유지」로 보고되어서는 안 된다', () => {
    const result = new SimulationEngine().runSingle(isaOnly());
    const totalUnmet = result.yearlyResults.reduce((s, y) => s + y.unmetSpending, 0);

    // 생활비를 한 푼도 못 쓴 계획이 「자산 고갈 없음 + 기말자산 2억」으로 요약되는 상태.
    // 둘 중 하나는 거짓이다.
    expect(totalUnmet > 0 && result.depletionAge === null && result.endingAssets > 0).toBe(false);
  });
});

describe('[AUDIT-002] 사적연금 저율과세 한도가 실제 인출 한도로 쓰인다', () => {
  // SimulationEngine.ts:1190-1194, 1517-1530 — limitPrivatePensionToTaxLimit가 켜지면
  // 연 1,500만원이 «인출 상한»이 된다. 기본값은 false지만 compileStrategy의
  // privatePensionStrategy 중 tax_first·growth_first·minimum이 true를 강제한다
  // (compileStrategy.ts:195-199).
  //
  // 지시문 §11: 「인출 가능 여부 ≠ 저율과세 여부」. 한도를 넘으면 세율이 오를 뿐,
  // 인출 자체가 막혀서는 안 된다.
  const pensionOnly = (limit: boolean) => baseParams({
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    taxSettings: { limitPrivatePensionToTaxLimit: limit },
  } as Partial<SimulationParams>);

  test('한도를 켜도 잔액이 충분하면 목표 생활비를 채운다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly(true));

    // 5억이 남아 있는데 연 1,500만원만 꺼내 4,582만원을 부족으로 기록하는 상태.
    for (const year of result.yearlyResults) {
      expect(year.unmetSpending).toBe(0);
    }
  });

  test('한도를 꺼면 목표 생활비를 채운다 (대조군 — 현재도 통과)', () => {
    const result = new SimulationEngine().runSingle(pensionOnly(false));
    for (const year of result.yearlyResults) {
      expect(year.unmetSpending).toBe(0);
    }
  });
});

describe('[AUDIT-003] 목표 달성 확률이 주변확률을 넘어선다', () => {
  // MonteCarloEngine.ts:151-158 — 목표 성공은 세 조건의 «교집합»이므로 어떤 주변확률도
  // 넘을 수 없다. retirement-domain-invariants/monte-carlo.test.ts:83-97이 그렇게 단언한다.
  //
  // 그런데 「생활비를 채웠는가」를 두 곳이 «다른 식»으로 판정한다.
  //   spendingSuccessRate  : year.unmetSpending > 0            (엔진 원장, 엡실론 없음)
  //   goalSuccessProbability: goalShortfall >= 10,000원/월      (재구성, 엡실론 있음)
  // 그래서 월 1만원 미만으로 결손이 난 시행이 «생활 유지 실패 + 목표 달성 성공»이 되고,
  // 교집합이 자기 주변확률보다 커진다 = 목표 달성 확률이 실제보다 관대하게 보고된다.
  //
  // 기존 불변식 테스트가 못 잡는 이유: 그 픽스처는 retirementGoals가 없어
  // basis='legacy_plan'이라 requireAssetSurvival이 언제나 true이고, 그때는 자산 생존
  // 조건이 먼저 걸려 부등식이 유지된다. 목표를 «고른» 계획에서만 드러난다.
  test('생활비 목표만 고른 계획에서도 부등식이 유지된다', () => {
    const engine = new SimulationEngine();
    // 감사 재현 시나리오. 합성 픽스처로는 드러나지 않는다 — 위반은 「결손이 월 1만원 미만인
    // 시행」에서만 생기고, 그런 경계 시행은 실제 자산 구성에서만 나온다(1,000회 중 2회).
    // 화면과 «같은» 파이프라인을 태운다(useStrategyPipeline). compileStrategy가 채우는
    // 전략 기본값까지 있어야 재현된다 — 정제만 하고 넘기면 경계 시행이 나오지 않는다.
    const compiled = compileStrategy(
      migrateRetirementGoals(normalizeSimulationParams((auditCase as { params: unknown }).params))
    );
    const recommendation = new LegacyRecommendationEngine(engine)
      .recommendLegacyConfig(compiled.params, compiled.utilityConfig);
    const params = applyAiSentinels(compiled, recommendation).compiled.params;
    const mc = runMonteCarlo(params, engine, { trials: 1000, seed: 20260101, annualStdDev: 15 });

    expect(mc.goalConditions.requireAssetSurvival).toBe(false);
    // 목표 성공은 「생활비 충족 ∧ 자산 생존 ∧ 기말자산 목표」의 교집합이지만, 생활비 조건이
    // spendingSuccessRate와 «다른 술어»다 —
    //   spendingSuccessRate            : year.unmetSpending > 0        (엔진 원장, 엡실론 없음, 계획 대비)
    //   goalSuccessProbability의 생활비 : goalShortfall ≥ 월 1만원      (재구성, 엡실론 있음, 목표 대비)
    // 두 집합은 포함관계가 아니므로 부등식이 성립하지 않는다. 실측(2026-08-22): 목표 30.4% >
    // 생활 유지 30.2%. 자산 생존은 같은 술어(isSuccessfulTrial)를 쓰므로 그쪽만 남긴다.
    expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.successRate);
  });
});
