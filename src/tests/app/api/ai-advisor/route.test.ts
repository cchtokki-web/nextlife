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
      nationalPensionOnlyUtility: null,
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
      nationalPensionOnlyUtility: null,
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
      nationalPensionOnlyUtility: null,
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

  test('FIRE 나이가 본인 기대수명 이내면 단서를 붙이지 않는다', () => {
    const userProfile = { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };
    const text = buildSimulationContextText({ ...baseBody, userProfile, fireAge: 65 });

    expect(text).toContain('FIRE 조기은퇴 가능 나이: 65세');
    expect(text).not.toContain('배우자 생존 기간');
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
