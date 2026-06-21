import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { score, monthlyTarget, isPro, userProfile } = await req.json();

    const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4-12b';

    const userProfileText = userProfile ? `
[사용자 기본 정보]
- 현재 나이: ${userProfile.currentAge}세
- 은퇴 예정 나이: ${userProfile.retirementAge}세
- 기대 수명: ${userProfile.expectancy}세
` : '';

    let systemPrompt = `당신은 전문적인 AI 노후 설계사입니다.
사용자의 시뮬레이션 점수와 목표 월 생활비, 그리고 입력한 기본 정보를 바탕으로 개인화되고 친절한 조언을 제공하세요.

${userProfileText}
[결과 요약]
- 결과 점수: ${score}점 (100점 만점)
- 목표 월 생활비: ${monthlyTarget.toLocaleString()}원

[가이드라인]
90점 이상이면 현재 나이와 은퇴 나이를 고려하여 충분히 가능하다는 긍정적인 메시지를 작성하세요.
70~89점이면 목표 생활비 대비 부족한 점을 짚어주고, 약간의 투자금 증액이나 은퇴 시기 연기를 제안하세요.
70점 미만이면 달성하기 어려울 수 있으니 구체적인 변화(투자금 대폭 증액, 은퇴 3년 이상 연기 등)를 제안하세요.

마지막에는 반드시 다음 문구를 포함하세요:
"마무리로 반드시 전문 공인 재무 설계사 또는 투자 자문전문가와 상의해야 합니다."
`;

    if (!isPro) {
      systemPrompt += `\n중요 제약사항: 사용자가 Basic 버전 사용 중이므로, 답변은 반드시 8줄 미만으로 짧게 작성해야 합니다. 핵심만 간단히 말하세요.`;
    }

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: systemPrompt,
        stream: true,
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to connect to Ollama' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
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
