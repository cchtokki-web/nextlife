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

    let systemPrompt = `당신은 친절하고 따뜻한 어조로 조언을 건네는 AI 노후 설계사입니다.
사용자의 시뮬레이션 점수와 목표 월 생활비, 그리고 입력한 기본 정보를 바탕으로 개인화된 조언을 제공하세요.

[답변 스타일 규칙]
1. "안녕하세요", "반갑습니다" 같은 불필요한 인삿말은 절대 생략하고 바로 본론부터 이야기하세요.
2. "결론적으로", "마무리로" 같은 형식적인 표현도 절대 사용하지 마세요.
3. 기계적이지 않은, 이웃집 전문가가 이야기하듯 부드럽고 친절한 대화체(해요체, 합쇼체)를 사용하세요.
4. <think> 태그나 내부 사고 과정을 절대 출력하지 마세요. 고민하는 과정 없이 곧바로 최종 답변만 출력하세요.

${userProfileText}
[결과 요약]
- 결과 점수: ${score}점 (100점 만점)
- 목표 월 생활비: ${Math.round(monthlyTarget / 10000)}만원

[가이드라인]
90점 이상이면 현재 나이와 은퇴 나이를 고려하여 충분히 가능하다는 긍정적인 메시지를 작성하세요.
70~89점이면 목표 생활비 대비 부족한 점을 짚어주고, 약간의 투자금 증액이나 은퇴 시기 연기를 제안하세요.
70점 미만이면 달성하기 어려울 수 있으니 구체적인 변화(투자금 대폭 증액, 은퇴 3년 이상 연기 등)를 제안하세요.

마지막 줄에는 반드시 다음 문장만 덧붙여주세요 (다른 수식어 없이):
"자세한 사항은 전문 공인 재무 설계사나 투자 자문 전문가와의 상담을 권장합니다."
`;

    if (!isPro) {
      systemPrompt += `\n중요 제약사항: 사용자가 Basic 버전 사용 중이므로, 답변은 반드시 8줄 미만으로 짧게 작성해야 합니다. 핵심만 간단히 말하세요.`;
    }

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
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
