import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSimulationContextText, POST } from '@/app/api/ai-advisor/route';
import { SimulationResult, StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';
import type { NextRequest } from 'next/server';

const baseUtility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 10, bequestAdequacy: 0 },
};

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0, comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
};

const emptyResult: SimulationResult = {
  yearlyResults: [],
  fireAge: 65,
  depletionAge: null,
  endingAssets: 0,
  retirementScore: 0,
  retirementGrade: '보통',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 0,
  householdEndAge: 90,
};

const baseBody = {
  score: 90,
  retirementGrade: '매우 안정' as const,
  monthlyTarget: 3000000,
  depletionAge: null,
};

describe('buildSimulationContextText - Utility Score 반영', () => {
  test('utility/recommendation 미지정 시 기존과 동일하게 Utility 관련 줄이 없다', () => {
    const text = buildSimulationContextText(baseBody);
    expect(text).not.toContain('평생 효용');
  });

  test('utility가 있으면 평생 효용 점수 줄과 강점/약점 요약을 포함한다', () => {
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility });
    expect(text).toContain('평생 효용 점수');
    expect(text).toContain('76');
    // bequestAdequacy 0/10 -> 약점으로 분류되어야 함
    expect(text).toContain('상속 자산 적정성');
  });

  test('recommendation이 baseline보다 개선되면 추천 이유를 포함한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: { ...baseUtility, score: 83 },
      verifiedSentinelPlan: [],
      recommendedUtility: { ...baseUtility, score: 87 },
      recommendedPlan: {
        privatePensionMonthlyTarget: 0,
        nationalPensionStartAge: 65,
        assetSellOrderStrategy: 'input_order',
        isaMaturityDestination: 'pension',
        generalAssetWithdrawalStartAge: 65,
        monthlySpendingMultiplier: 1,
      },
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: null,
      channelingIncludesAccountTransfer: false,
      improved: true,
      reasons: ['65세부터 일반 자산(주식/ETF) 인출을 시작합니다.'],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: emptyResult,
      itemizedContributions: [],
    };
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility, recommendation });

    expect(text).toContain('83');
    expect(text).toContain('87');
    expect(text).toContain('65세부터 일반 자산(주식/ETF) 인출을 시작합니다.');
    expect(text).not.toContain('추가 납입한다는 가정');
  });

  // Fix(중요 #4) 회귀: recommendedNewPensionContribution이 채택되면 개선분의 일부가 신규 납입
  // 자금에서 나온다는 단서(newPensionCaveat)가 실제로 컨텍스트 텍스트에 삽입되는지 검증한다.
  // 지금까지는 이 분기 자체가 테스트되지 않아, 조건식이 뒤집히거나 삭제돼도 테스트가 통과했다.
  test('recommendedNewPensionContribution이 true면 신규 납입 가정 캐비트를 포함한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: { ...baseUtility, score: 70 },
      verifiedSentinelPlan: [],
      recommendedUtility: { ...baseUtility, score: 85 },
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: true,
      channelingIncludesAccountTransfer: false,
      improved: true,
      reasons: ['연금 계좌를 새로 개설해 퇴직 전까지 월 75만원을 추가로 납입합니다.'],
      deltas: zeroDeltas,
      totalCandidateCount: 1,
      failedCandidateCount: 0,
      recommendedResult: emptyResult,
      itemizedContributions: [],
    };
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility, recommendation });

    expect(text).toContain('추가 납입한다는 가정이 포함되어 있어');
    expect(text).toContain('70점');
    expect(text).toContain('85점');
  });

  test('recommendation이 baseline과 동일하면(개선 없음) 추천 관련 줄을 추가하지 않는다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: { ...baseUtility, score: 83 },
      verifiedSentinelPlan: [],
      recommendedUtility: { ...baseUtility, score: 83 },
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: null,
      channelingIncludesAccountTransfer: false,
      improved: false,
      reasons: ['현재 전략이 이미 합리적입니다.'],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: emptyResult,
      itemizedContributions: [],
    };
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility, recommendation });

    expect(text).not.toContain('AI 추천 전략');
  });

  test('기존 필드(은퇴 준비도 점수 등)는 그대로 유지된다', () => {
    const text = buildSimulationContextText(baseBody);
    expect(text).toContain('은퇴 준비도 점수');
    expect(text).toContain('90점');
  });

  test('기대수명 시점 잔여 자산이 1억원을 넘으면 "179,169만원"이 아니라 억 단위로 표기한다', () => {
    const text = buildSimulationContextText({ ...baseBody, endingAssets: 1791690000 });
    expect(text).toContain('17억 9,169만원');
    expect(text).not.toContain('179,169만원');
  });

  // A2: fireAge는 가구 종료 나이 기준으로 판정되므로 배우자가 더 오래 사는 계획에서는
  // 본인 기대수명을 넘을 수 있다. 단서를 붙이지 않으면 같은 프롬프트가 "80세 사망"과
  // "85세 FIRE"를 나란히 제시해 LLM이 모순된 두 숫자를 받는다.
  test('FIRE 나이가 본인 기대수명을 넘으면 배우자 생존 기간 기준임을 함께 넣는다', () => {
    const userProfile = { currentAge: 55, retirementAge: 60, expectancy: 80, targetMonthlySpending: 3000000 };
    const text = buildSimulationContextText({ ...baseBody, userProfile, fireAge: 85 });

    expect(text).toContain('배우자 생존 기간');
  });

  test('FIRE 나이가 본인 기대수명 이내면 배우자 단서를 붙이지 않는다', () => {
    const userProfile = { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };
    const text = buildSimulationContextText({ ...baseBody, userProfile, fireAge: 65 });

    expect(text).toContain('소득만으로 생활비 충당 가능 시점: 65세');
    expect(text).not.toContain('배우자 생존 기간');
  });

  // 라벨이 "FIRE 조기은퇴 가능 나이"였을 때는, 60세 은퇴를 계획한 사용자에게 65라는 숫자가
  // 그대로 전달되어 LLM이 "65세에 조기은퇴할 수 있다"고 답했다. 은퇴 계획보다 늦은 시점은
  // 조기은퇴가 아니므로 상대 위치를 함께 넣는다.
  test('FIRE 나이가 은퇴 계획보다 늦으면 몇 년 늦는지 함께 넣는다', () => {
    const userProfile = { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };
    const text = buildSimulationContextText({ ...baseBody, userProfile, fireAge: 65 });

    expect(text).toContain('5년 늦음');
    expect(text).not.toContain('조기은퇴');
  });
});

describe('POST /api/ai-advisor - Ollama 요청 시 think:false 전달', () => {
  // 회귀 가드: reasoning 지원 모델(예: gemma4:12b-mlx)은 think 옵션이 없으면 응답 전에
  // message.thinking 필드로 긴 사고 과정을 스트리밍한다. 클라이언트는 message.content만
  // 렌더링하므로 이 사고 과정이 진행되는 동안 "AI 분석 의견을 작성하고 있습니다..." 상태에서
  // 수십 초 이상 멈춘 것처럼 보인다(실제로 발생을 확인한 버그). think:false로 이를 방지한다.
  const originalEndpoint = process.env.OLLAMA_ENDPOINT;

  beforeEach(() => {
    process.env.OLLAMA_ENDPOINT = 'http://fake-ollama:11434';
  });

  afterEach(() => {
    process.env.OLLAMA_ENDPOINT = originalEndpoint;
    vi.restoreAllMocks();
  });

  test('Ollama /api/chat 요청 바디에 think:false가 포함된다', async () => {
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: '안녕' }, done: true }) + '\n'));
        controller.close();
      },
    });

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(fakeStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    const req = new Request('http://localhost/api/ai-advisor', {
      method: 'POST',
      body: JSON.stringify({ score: 80, monthlyTarget: 3000000, depletionAge: null }),
    });

    await POST(req as unknown as NextRequest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/api/chat');
    const sentBody = JSON.parse((options as RequestInit).body as string);
    expect(sentBody.think).toBe(false);
  });
});

// 투자자산이 없는 계획에서 LLM이 "51세에 자산이 고갈됩니다"라고 쓰지 않도록, 프롬프트
// 컨텍스트가 그 사실과 금지 사항을 명시해야 한다.
describe('buildSimulationContextText - 투자자산 미보유 계획', () => {
  test('고갈 나이 대신 미보유임을 밝히고 고갈 표현을 금지한다', () => {
    const text = buildSimulationContextText({
      score: 32,
      monthlyTarget: 3500000,
      depletionAge: 51,
      planAssetStatus: 'no_investable_asset',
      sustainableMonthlySpending: 1910000,
    });

    expect(text).toContain('투자자산 미보유');
    expect(text).toContain('고갈이라는 표현을 쓰지 말 것');
    expect(text).not.toContain('자산 고갈 예상 나이: 51세');
    expect(text).toContain('유지 가능한 월 생활비: 191만원');
  });

  test('투자자산이 있으면 기존처럼 고갈 나이를 그대로 싣는다', () => {
    const text = buildSimulationContextText({
      score: 45,
      monthlyTarget: 3000000,
      depletionAge: 80,
      planAssetStatus: 'depleted',
    });

    expect(text).toContain('자산 고갈 예상 나이: 80세');
    expect(text).not.toContain('투자자산 미보유');
  });

  // 목표 우선순위가 배점을 갈아끼우므로, 가중치를 넘기지 않으면 강점/약점 문장이
  // "세금 효율이(가) 21/10점으로 우수합니다"처럼 만점을 넘긴 분수를 인용한다.
  test('utilityWeights를 넘기면 강점/약점 문장이 그 배점을 분모로 쓴다', () => {
    const taxMinUtility: UtilityBreakdown = {
      score: 55,
      components: { consumption: 6, depletionSafety: 0, pensionUtilization: 8, taxEfficiency: 21, taxationRisk: 15, bequestAdequacy: 5 },
    };

    const text = buildSimulationContextText({
      score: 32,
      monthlyTarget: 3500000,
      depletionAge: null,
      utility: taxMinUtility,
      utilityWeights: { consumption: 25, depletionSafety: 15, pensionUtilization: 15, taxEfficiency: 25, taxationRisk: 15, bequestAdequacy: 5 },
    });

    expect(text).toContain('21/25');
    expect(text).not.toContain('21/10');
  });
});
