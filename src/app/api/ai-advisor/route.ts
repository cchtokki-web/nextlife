import { NextRequest } from 'next/server';
import { generateRuleBasedAdvice } from './ruleBasedAdvisor';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { score, monthlyTarget, isPro, userProfile, depletionAge } = await req.json();

    const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT;
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4-12b';

    if (!OLLAMA_ENDPOINT || OLLAMA_ENDPOINT.trim() === '') {
      // Fallback to rule-based advice
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, isPro, userProfile, depletionAge);
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // 글자 단위 또는 청크 단위로 잘라 스트리밍 효과 구현
          const chunks = adviceText.match(/.{1,15}/g) || [adviceText];
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

    const userProfileText = userProfile ? `
[사용자 기본 정보]
- 현재 나이: ${userProfile.currentAge}세
- 은퇴 예정 나이: ${userProfile.retirementAge}세
- 기대 수명: ${userProfile.expectancy}세
` : '';

    let systemPrompt = `당신은 핵심 요점만 전달하는 AI 노후 설계사입니다.
사용자의 시뮬레이션 결과를 분석하여 노후 자산 상태와 핵심 조언을 전달하세요.

[답변 규칙]
1. 반드시 **딱 2개의 문장**으로만 작성하세요. 미사여구, 불필요한 인사말, 위로나 격려, 맺음말(권장합니다 등)은 모두 제거하고 팩트 위주로 요점만 전달하세요.
2. 중요한 정보(점수, 금액, 핵심 조언 등)는 반드시 **텍스트** 처럼 마크다운 볼드체를 사용하여 강조하세요.
3. <think> 태그나 내부 사고 과정을 절대 출력하지 마세요. 곧바로 최종 답변만 출력하세요.

${userProfileText}
[결과 요약]
- 결과 점수: ${score}점 (100점 만점)
- 은퇴 후 자산 고갈 나이: ${depletionAge === null ? '고갈 위험 없음' : `${depletionAge}세`}
- 목표 월 생활비: ${Math.round(monthlyTarget / 10000)}만원

[작성 가이드]
- 첫 번째 문장: 은퇴 성공 확률/점수와 자산 고갈 가능성에 대한 직설적인 상태 진단.
- 두 번째 문장: 목표 생활비 유지를 위해 필요한 명확한 액션 플랜 또는 제안.
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
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }
    } catch (fetchError) {
      console.warn('Failed to connect to Ollama, falling back to rule-based advice:', fetchError);
      
      // Fallback to rule-based advice
      const adviceText = generateRuleBasedAdvice(score, monthlyTarget, isPro, userProfile, depletionAge);
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const chunks = adviceText.match(/.{1,15}/g) || [adviceText];
          for (const chunk of chunks) {
            const payload = JSON.stringify({ isRuleBased: true, message: { content: chunk } }) + '\n';
            controller.enqueue(encoder.encode(payload));
            await new Promise(r => setTimeout(r, 15));
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

    // Return the readable stream directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Ollama API error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
