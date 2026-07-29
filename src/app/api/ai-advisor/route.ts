import { NextRequest } from 'next/server';
import { generateRuleBasedAdvice } from './ruleBasedAdvisor';
import {
  UserProfile, InvestmentAsset, PrivatePension, NationalPension,
  OtherIncome, TaxSettings, SpendingStrategy, UtilityBreakdown, StrategyRecommendation,
} from '../../../core/entities/types';
import { RetirementGrade } from '../../../core/entities/retirementGrade';
import { analyzeCurrentStrategy, formatManwon } from '../../../core/usecases/utility/utilityAnalysis';

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
  otherIncomes?: OtherIncome[];
  taxSettings?: TaxSettings;
  spendingStrategy?: SpendingStrategy;
  inflationRate?: number;
  inflationMode?: 'nominal' | 'real';
  utility?: UtilityBreakdown;
  recommendation?: StrategyRecommendation;
}

function toManwon(val?: number): string {
  if (typeof val !== 'number' || isNaN(val)) return '정보 없음';
  return Math.round(val / 10000).toLocaleString();
}

export function buildSimulationContextText(body: AiAdvisorRequestBody): string {
  const {
    userProfile, assets, privatePensions, nationalPension, otherIncomes,
    taxSettings, spendingStrategy, inflationRate, inflationMode,
    goalAchievementRate, fireAge, endingAssets, monthlyTarget, score, depletionAge,
    retirementGrade, utility, recommendation,
  } = body;

  const lines: string[] = [];

  if (userProfile) {
    lines.push(`- 현재 나이: ${userProfile.currentAge}세 / 은퇴 목표 나이: ${userProfile.retirementAge}세 / 기대 수명: ${userProfile.expectancy}세`);
  }
  lines.push(`- 목표 월 생활비: ${toManwon(monthlyTarget)}만원`);
  lines.push(`- 은퇴 준비도 점수: ${score}점 (등급: ${retirementGrade ?? '정보 없음'})`);

  if (utility) {
    lines.push(
      `- 평생 효용 점수(은퇴 준비도 점수와는 별개의 지표로 "자산을 얼마나 잘 ` +
      `활용하는가"를 종합 평가): ${utility.score}점/100점`
    );
    const analysis = analyzeCurrentStrategy(utility);
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
  lines.push(`- FIRE 조기은퇴 가능 나이: ${fireAge ? `${fireAge}세` : '달성 불가능'}`);
  lines.push(`- 자산 고갈 예상 나이: ${depletionAge === null || depletionAge === undefined ? '고갈 위험 없음' : `${depletionAge}세`}`);
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
    const { score, monthlyTarget, isPro, userProfile, depletionAge, retirementGrade, utility, recommendation } = body;

    const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT;
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4-12b';

    if (!OLLAMA_ENDPOINT || OLLAMA_ENDPOINT.trim() === '') {
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, !!isPro, userProfile, depletionAge, retirementGrade, utility, recommendation);
      return buildRuleBasedStream(adviceText);
    }

    const simulationContextText = buildSimulationContextText(body);

    let systemPrompt = `당신은 핵심 요점만 전달하는 AI 노후 설계사입니다.
아래 [시뮬레이션 결과 전체]를 빠짐없이 종합적으로 참고하여 노후 자산 상태와 핵심 조언을 전달하세요.

[답변 규칙]
1. 반드시 **딱 2개의 문장**으로만 작성하세요. 미사여구, 불필요한 인사말, 위로나 격려는 모두 제거하고 팩트 위주로 요점만 전달하세요. 상담을 권유하는 맺음말은 시스템이 별도로 자동 추가하므로 작성하지 마세요.
2. 중요한 정보(점수, 금액, 핵심 조언 등)는 반드시 **텍스트**처럼 마크다운 볼드체를 사용하여 강조하세요.
3. <think> 태그나 내부 사고 과정을 절대 출력하지 마세요. 곧바로 최종 답변만 출력하세요.
4. 종합 진단은 반드시 "은퇴 준비도 점수/등급"과 "자산 고갈 예상 나이"를 1차 기준으로 삼으세요. "고정소득 커버율"은 배당·연금 등 원금 인출을 제외한 보조 지표이므로, 이 값이 100% 미만이라는 이유만으로 위험하다고 단정하지 마세요. 자산 고갈 예상 나이가 없고 기대수명 시점 잔여 자산이 충분하다면, 고정소득 커버율이 낮아도 안정적인 은퇴로 해석하세요.
5. [시뮬레이션 결과 전체]에 "AI 추천 전략"이 포함되어 있다면(=평생 효용 점수를 더 높일 수 있는 인출 전략이 존재한다는 뜻), 두 번째 문장의 액션 플랜에 이를 우선적으로 반영하세요. 없다면 언급하지 마세요.

[시뮬레이션 결과 전체]
${simulationContextText}

[작성 가이드]
- 첫 번째 문장: 은퇴 준비도 등급(매우 안정/안정/보통/주의/위험)과 자산 고갈 가능성을 우선 기준으로 한 직설적인 상태 진단. 고정소득 커버율이 낮다는 이유만으로 부정적으로 서술하지 말 것.
- 두 번째 문장: AI 추천 전략이 있다면 그 내용(구체적인 인출 시점/방식 변경)을 우선 제시하고, 없다면 연금 구성·세금 설정·자산 구성 등 위 데이터를 근거로 한 구체적인 액션 플랜 또는 제안.
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
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, !!isPro, userProfile, depletionAge, retirementGrade, utility, recommendation);
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
  } catch (error: any) {
    console.error('Ollama API error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
