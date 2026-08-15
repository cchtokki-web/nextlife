import { NextRequest } from 'next/server';
import { generateRuleBasedAdvice } from './ruleBasedAdvisor';
import {
  UserProfile, InvestmentAsset, PrivatePension, NationalPension,
  OtherIncome, TaxSettings, SpendingStrategy, UtilityBreakdown, UtilityConfig, StrategyRecommendation,
} from '../../../core/entities/types';
import { RetirementGrade } from '../../../core/entities/retirementGrade';
import { analyzeCurrentStrategy, formatManwon } from '../../../core/usecases/utility/utilityAnalysis';
import { describeFireAge } from '../../../core/usecases/dashboard/describeFireAge';
import { PlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { PensionGapRisk } from '../../../core/usecases/dashboard/computePensionGapRisk';

export const runtime = 'edge';

// 상담 권유 문구는 LLM이 매번 다르게 쓰거나 생략하지 않도록, 어떤 경로(LLM/규칙 기반)든
// 항상 코드에서 동일하게 덧붙인다.
const DISCLAIMER = '\n\n실제 투자 결정 시에는 반드시 전문 공인 재무 설계사 또는 투자 자문 전문가와 상세한 내용을 상담하시기 바랍니다.';

export interface AiAdvisorRequestBody {
  score: number;
  retirementGrade?: RetirementGrade;
  monthlyTarget: number;
  isPro?: boolean;
  userProfile?: UserProfile;
  depletionAge: number | null;
  goalAchievementRate?: number;
  fireAge?: number | null;
  endingAssets?: number;
  assets?: InvestmentAsset[];
  privatePensions?: PrivatePension[];
  nationalPension?: NationalPension;
  nationalPensionStartAge?: number;
  otherIncomes?: OtherIncome[];
  taxSettings?: TaxSettings;
  spendingStrategy?: SpendingStrategy;
  inflationRate?: number;
  inflationMode?: 'nominal' | 'real';
  utility?: UtilityBreakdown;
  // utility.components의 배점. 목표 우선순위가 이 값을 갈아끼우므로, 없으면 강점/약점
  // 문장이 "세금 효율이(가) 21/10점으로 우수합니다"처럼 만점을 넘긴 분수를 인용한다.
  utilityWeights?: UtilityConfig['weights'];
  recommendation?: StrategyRecommendation;
  // 자산 고갈과 자산 미보유를 가른다. 없으면(옛 클라이언트) 기존 문구를 그대로 쓴다.
  planAssetStatus?: PlanAssetStatus;
  sustainableMonthlySpending?: number;
  // 자산 보존 성공률(기대수명까지 자산이 남을 확률).
  monteCarloSuccessRate?: number;
  // 생활 유지 성공률(계획한 생활비를 한 해도 줄이지 않을 확률). 자산 고갈과 독립적으로 센다.
  monteCarloSpendingSuccessRate?: number;
  // 은퇴~국민연금 개시 사이의 공백 구간. 조언 우선순위 2번의 근거다.
  pensionGap?: PensionGapRisk;
}

function toManwon(val?: number): string {
  if (typeof val !== 'number' || isNaN(val)) return '정보 없음';
  return Math.round(val / 10000).toLocaleString();
}

export function buildSimulationContextText(body: AiAdvisorRequestBody): string {
  const {
    userProfile, assets, privatePensions, nationalPension, nationalPensionStartAge, otherIncomes,
    taxSettings, spendingStrategy, inflationRate, inflationMode,
    goalAchievementRate, fireAge, endingAssets, monthlyTarget, score, depletionAge,
    retirementGrade, utility, utilityWeights, recommendation, planAssetStatus, sustainableMonthlySpending,
    monteCarloSuccessRate, monteCarloSpendingSuccessRate, pensionGap,
  } = body;

  const lines: string[] = [];

  if (userProfile) {
    lines.push(`- 현재 나이: ${userProfile.currentAge}세 / 은퇴 목표 나이: ${userProfile.retirementAge}세 / 기대 수명: ${userProfile.expectancy}세`);
  }
  lines.push(`- 목표 월 생활비: ${toManwon(monthlyTarget)}만원`);
  lines.push(`- 은퇴 준비도 점수: ${score}점 (등급: ${retirementGrade ?? '정보 없음'})`);
  // 두 확률의 이름과 정의를 함께 넘긴다. 이름만 넘기면 LLM이 "자산 유지 확률"이라는 말로
  // 생활 유지 숫자를 설명하거나 그 반대를 한다 — 두 값이 크게 갈리는 계획(연금이 두꺼운
  // 계획)에서 그 혼동이 정확히 반대 결론을 만든다.
  if (typeof monteCarloSpendingSuccessRate === 'number' || typeof monteCarloSuccessRate === 'number') {
    const parts: string[] = [];
    if (typeof monteCarloSpendingSuccessRate === 'number') {
      parts.push(
        `생활 유지 성공률(계획한 생활비를 한 해도 줄이지 않을 확률) ${Math.round(monteCarloSpendingSuccessRate * 100)}%`
      );
    }
    if (typeof monteCarloSuccessRate === 'number') {
      parts.push(`자산 보존 성공률(기대수명까지 자산이 남을 확률) ${Math.round(monteCarloSuccessRate * 100)}%`);
    }
    lines.push(
      `- 시장 변동성 분석: ${parts.join(' / ')}. ` +
      '**이 확률이 계획의 최종 판정 근거다.** 결정론적 기준 시나리오 결과(자산 고갈 나이 등)는 ' +
      '"수익률이 가정대로 실현될 때"라는 조건부 결과이므로, 그것만 근거로 "안정적"이라고 쓰지 말 것. ' +
      '두 확률이 크게 다르면 그 차이가 무엇을 뜻하는지 밝힐 것(생활 유지가 높으면 종신연금이 ' +
      '생활비를 메우는 것이고, 자산 보존이 높으면 생활수준을 깎아 버티는 것이다).'
    );
  }
  if (pensionGap) {
    const gapDetail = pensionGap.shortfallYears > 0
      ? `${pensionGap.shortfallYears}년간 월 평균 ${formatManwon(pensionGap.averageMonthlyShortfall)}의 생활비가 ` +
        `미충족되고, 실제 월 평균 자산인출은 ${formatManwon(pensionGap.monthlyAssetWithdrawal)}임.`
      : `월 평균 ${formatManwon(pensionGap.monthlyAssetWithdrawal)}을 자산에서 인출함.`;
    lines.push(
      `- 연금 공백 구간: ${pensionGap.fromAge}~${pensionGap.toAge}세 ${pensionGap.years}년간 국민연금 없이 ` +
      `${gapDetail} 이 구간 총 필요자금 약 ${formatManwon(pensionGap.bridgeAmount)}. ` +
      (pensionGap.monthlyAssetWithdrawal > 0
        ? '은퇴 직후 자산을 인출하므로 시장 하락 순서에 취약한 구간임.'
        : '일반자산 인출 시작 조건 때문에 보유자산을 생활비로 쓰지 못하는 유동성 공백임.')
    );
  }

  if (utility) {
    lines.push(
      `- 평생 효용 점수(은퇴 준비도 점수와는 별개의 지표로 "자산을 얼마나 잘 ` +
      `활용하는가"를 종합 평가): ${utility.score}점/100점`
    );
    // 가중치를 넘기지 않으면 기본 배점이 쓰여 PDF 리포트의 효용 막대와 다른 분모를 말하게 된다.
    const analysis = analyzeCurrentStrategy(
      utility,
      utilityWeights ? { weights: utilityWeights } : undefined,
      { planAssetStatus }
    );
    lines.push(`  - 강점: ${analysis.strengths.join(' ')}`);
    lines.push(`  - 약점: ${analysis.weaknesses.join(' ')}`);
  }

  if (recommendation?.improved) {
    // 신규 연금계좌 납입 레그가 채택되면 개선분의 일부는 기존 자산 재배치가 아니라 사용자가
    // 새로 마련해야 하는 자금에서 나온다. AI가 "지금 자산만 잘 굴리면 N점"이라고 단정하지
    // 않도록 이 전제를 컨텍스트에 명시한다.
    const newPensionCaveat = recommendation.recommendedNewPensionContribution
      ? ' ※ 이 점수에는 연금 계좌를 새로 개설해 월 75만원(연 900만원)을 추가 납입한다는 가정이 포함되어 있어, 기존 자산 재배치만으로 달성되는 점수가 아님.'
      : '';
    lines.push(
      `- AI 추천 전략: 인출 전략을 조정하면 평생 효용 점수를 ${recommendation.currentUtility.score}점에서 ` +
      `${recommendation.recommendedUtility.score}점으로 높일 수 있음. 추천 이유: ${recommendation.reasons.join(' ')}` +
      newPensionCaveat
    );
  } else if (
    recommendation
    && recommendation.totalCandidateCount > 0
    && recommendation.failedCandidateCount === recommendation.totalCandidateCount
  ) {
    // 후보를 전부 평가 못 한 것과 "이미 최적"은 다른 상황이므로, AI가 "이미 최적화되어 있다"고
    // 단정적으로 조언하지 않도록 계산 실패 사실 자체를 컨텍스트에 남긴다.
    lines.push('- AI 추천 전략: 전략 후보를 평가하는 중 오류가 발생해 추천 계산에 실패함(최적화 여부 판단 불가).');
  }

  lines.push(
    `- 고정소득 커버율(배당·연금·기타소득 등, 자산 매도·인출분 제외): ${goalAchievementRate ?? '정보 없음'}% ` +
    `※ 이 값이 100% 미만이어도 "자산 고갈 예상 나이"가 없다면 원금을 정상적으로 인출하며 사는 안정적인 은퇴일 수 있음`
  );
  // describeFireAge는 fireAge를 retirementAge와 비교해 문구를 만든다. userProfile이
  // 없으면 비교 기준인 retirementAge 자체가 없으므로 describeFireAge를 호출하지 않고
  // fireAge 숫자만(비교 없이) 적는다.
  lines.push(
    `- 소득만으로 생활비 충당 가능 시점: ${userProfile ? describeFireAge(fireAge, userProfile.retirementAge) : (fireAge ? `${fireAge}세` : '달성 불가능')}`
  );
  // 투자자산이 없는 계획은 엔진이 첫 해에 depletionAge를 잡는다. 그 나이를 그냥 넘기면
  // LLM이 "51세에 자산이 고갈됩니다"라고 쓰는데, 고갈시킬 자산이 애초에 없다.
  if (planAssetStatus === 'no_investable_asset') {
    lines.push(
      '- 자산 고갈 예상 나이: 해당 없음 — 등록된 투자자산·사적연금·ISA가 전혀 없어 ' +
      '"자산 고갈"이 아니라 "투자자산 미보유" 상태임. 고갈이라는 표현을 쓰지 말 것.'
    );
    if (typeof sustainableMonthlySpending === 'number' && sustainableMonthlySpending > 0) {
      lines.push(`- 추가 저축 없이 유지 가능한 월 생활비: ${formatManwon(sustainableMonthlySpending)}`);
    }
  } else {
    lines.push(`- 자산 고갈 예상 나이: ${depletionAge === null || depletionAge === undefined ? '고갈 위험 없음' : `${depletionAge}세`}`);
  }
  lines.push(
    `- 기대수명 시점 잔여 자산: ${typeof endingAssets === 'number' && !isNaN(endingAssets) ? formatManwon(endingAssets) : '정보 없음'}`
  );

  if (spendingStrategy) {
    const strategyLabel = spendingStrategy === 'dividend_only'
      ? '배당금(이자) 100% 소비'
      : spendingStrategy === 'max_sustainable'
        ? '최대 가능 생활비 자동계산'
        : '고정 목표 생활비';
    lines.push(`- 인출 전략: ${strategyLabel}`);
  }
  if (typeof inflationRate === 'number') {
    lines.push(`- 물가 상승률: ${inflationRate}% (${inflationMode === 'real' ? '실질가치' : '명목가치'} 기준)`);
  }
  if (nationalPension?.expectedMonthlyAmount !== undefined) {
    lines.push(`- 국민연금 예상 월 수령액: ${Number(nationalPension.expectedMonthlyAmount).toLocaleString()}원`);
  }
  // 개시 나이를 함께 알려야 이미 반영된 연기 수령을 다시 권하지 않는다.
  if (typeof nationalPensionStartAge === 'number') {
    lines.push(`- 국민연금 수령 개시 나이: ${nationalPensionStartAge}세 (이 시뮬레이션에 이미 반영된 값)`);
  }

  if (Array.isArray(privatePensions) && privatePensions.length > 0) {
    const summary = privatePensions
      .map((p) => `${p.name ?? p.type}(잔액 ${toManwon(p.balance)}만, 월 ${toManwon(p.monthlyContribution)}만 납입, 수익률 ${p.annualReturn}%)`)
      .join(', ');
    lines.push(`- 사적연금: ${summary}`);
  } else {
    lines.push('- 사적연금: 없음');
  }

  if (Array.isArray(assets) && assets.length > 0) {
    const summary = assets
      .map((a) => `${a.name}(${a.type}, 연 성장률 ${a.annualGrowthRate}%, 배당률 ${a.dividendYield}%, 월 ${toManwon(a.monthlyContribution)}만 납입)`)
      .join(', ');
    lines.push(`- 투자 자산: ${summary}`);
  } else {
    lines.push('- 투자 자산: 없음');
  }

  if (Array.isArray(otherIncomes) && otherIncomes.length > 0) {
    const summary = otherIncomes
      .map((i) => `${i.label} 월 ${toManwon(i.monthlyAmount)}만`)
      .join(', ');
    lines.push(`- 기타 소득: ${summary}`);
  }

  if (taxSettings) {
    const limit = toManwon(taxSettings.privatePensionLimit ?? 15000000);
    lines.push(`- 세금 설정: 금융소득종합과세 ${taxSettings.enableComprehensiveTax ? '반영' : '미반영'}, 사적연금 저율과세 한도 연 ${limit}만원, 한도 초과 시 세율 ${taxSettings.privatePensionExcessTaxRate ?? 16.5}%`);
  }

  return lines.join('\n');
}

function buildRuleBasedStream(adviceText: string) {
  const encoder = new TextEncoder();
  const fullText = adviceText + DISCLAIMER;
  const stream = new ReadableStream({
    async start(controller) {
      // 글자 단위 또는 청크 단위로 잘라 스트리밍 효과 구현
      const chunks = fullText.match(/.{1,15}/g) || [fullText];
      for (const chunk of chunks) {
        const payload = JSON.stringify({ isRuleBased: true, message: { content: chunk } }) + '\n';
        controller.enqueue(encoder.encode(payload));
        await new Promise(r => setTimeout(r, 15)); // 짧은 지연
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: AiAdvisorRequestBody = await req.json();
    const {
      score, monthlyTarget, isPro, userProfile, depletionAge, retirementGrade, utility, recommendation,
      planAssetStatus, goalAchievementRate, sustainableMonthlySpending,
      monteCarloSuccessRate, monteCarloSpendingSuccessRate, pensionGap,
    } = body;
    // 규칙 기반 폴백도 LLM과 같은 근거를 봐야 한다 — 두 경로가 서로 다른 진단을 내면
    // 같은 계획인데 Ollama 가용 여부에 따라 화면 문구가 달라진다.
    const ruleBasedContext = {
      planAssetStatus, goalAchievementRate, sustainableMonthlySpending,
      monteCarloSuccessRate, monteCarloSpendingSuccessRate, pensionGap,
    };

    const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT;
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4-12b';

    if (!OLLAMA_ENDPOINT || OLLAMA_ENDPOINT.trim() === '') {
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, !!isPro, userProfile, depletionAge, retirementGrade, utility, recommendation, ruleBasedContext);
      return buildRuleBasedStream(adviceText);
    }

    const simulationContextText = buildSimulationContextText(body);

    const systemPrompt = `당신은 핵심 요점만 전달하는 AI 노후 설계사입니다.
아래 [시뮬레이션 결과 전체]를 빠짐없이 종합적으로 참고하여 노후 자산 상태와 핵심 조언을 전달하세요.

[답변 규칙]
1. 반드시 **딱 2개의 문장**으로만 작성하세요. 미사여구, 불필요한 인사말, 위로나 격려는 모두 제거하고 팩트 위주로 요점만 전달하세요. 상담을 권유하는 맺음말은 시스템이 별도로 자동 추가하므로 작성하지 마세요.
2. 중요한 정보(점수, 금액, 핵심 조언 등)는 반드시 **텍스트**처럼 마크다운 볼드체를 사용하여 강조하세요.
3. <think> 태그나 내부 사고 과정을 절대 출력하지 마세요. 곧바로 최종 답변만 출력하세요.
4. 종합 진단의 1차 기준은 **"시장 변동성 분석"의 두 성공률**입니다. 결정론 기준 시나리오 결과(자산 고갈 예상 나이, 기대수명 시점 잔여 자산)만 근거로 "안정적"이라고 쓰지 마세요 — 그것은 "수익률이 가정대로 실현될 때"에만 참인 조건부 결과입니다. 성공률이 낮은데 기준 시나리오가 멀쩡하다면, 그 사실 자체를 진단으로 쓰세요. "고정소득 커버율"은 원금 인출을 제외한 보조 지표이므로 이 값이 100% 미만이라는 이유만으로 위험하다고 단정하지 마세요.
5. **액션 플랜의 우선순위는 다음 순서를 따르세요: ① 은퇴 시점 조정 → ② 연금 공백 구간 대비 → ③ 목표 생활비 조정 → ④ 투자 포트폴리오 → ⑤ 인출·매도 순서.** 앞 순위의 근거가 [시뮬레이션 결과 전체]에 있으면 그것을 먼저 제시하세요. 인출 순서·매도 순서 조언(예: "배당수익률이 낮은 자산부터 매도")을 두 번째 문장의 **첫 조언으로 쓰지 마세요** — 이 계획에서 효과가 가장 작은 레버입니다.
6. "투자자산 미보유" 상태라고 명시되어 있으면, "자산 고갈"·"자산이 고갈된다"는 표현을 절대 쓰지 마세요. 인출 순서 조정·자산 재배치·매도 전략처럼 존재하지 않는 자산을 전제로 한 조언도 하지 마세요. 대신 목표 생활비 조정, 은퇴 시점, 국민연금 수령 시점, 추가 저축·투자만 제안하세요.
7. "투자자산 소진"과 "생활비 부족"은 서로 다른 사건입니다. 투자자산이 소진돼도 국민연금이 생활비를 덮으면 생활은 유지됩니다 — 그 경우 "자산이 고갈되어 위험하다"가 아니라 "투자자산은 소진되지만 연금이 생활비를 채운다"고 쓰세요.

[시뮬레이션 결과 전체]
${simulationContextText}

[작성 가이드]
- 첫 번째 문장: 시장 변동성 분석의 성공률을 1차 근거로 한 직설적인 상태 진단. 기준 시나리오 결과를 함께 쓸 때는 반드시 "기준 수익률이 실현되면"이라는 조건을 붙일 것.
- 두 번째 문장: 규칙 5의 우선순위에 따른 액션 플랜 하나. 연금 공백 구간이 있으면 그 대비가 상위 후보다.
`;

    let response;
    try {
      response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '내 시뮬레이션 결과에 대해 조언해줘.' }
          ],
          stream: true,
          // reasoning 지원 모델(예: gemma4:12b-mlx)은 기본적으로 답변 전에 message.thinking 필드로
          // 긴 사고 과정을 스트리밍한다. 클라이언트는 message.content만 렌더링하므로 thinking이
          // 진행되는 동안(수십 초 이상) 화면이 "작성 중" 상태로 멈춰 보인다. think:false로 이
          // 사고 과정 자체를 비활성화해 곧바로 최종 답변만 받는다.
          think: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }
    } catch (fetchError) {
      console.warn('Failed to connect to Ollama, falling back to rule-based advice:', fetchError);
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, !!isPro, userProfile, depletionAge, retirementGrade, utility, recommendation, ruleBasedContext);
      return buildRuleBasedStream(adviceText);
    }

    // Ollama 스트림을 그대로 전달하되, 스트림이 끝나는 시점에 상담 권유 문구를 한 청크 덧붙인다.
    const encoder = new TextEncoder();
    const appendDisclaimer = new TransformStream({
      flush(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: DISCLAIMER } }) + '\n'));
      }
    });

    return new Response(response.body!.pipeThrough(appendDisclaimer), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Ollama API error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
