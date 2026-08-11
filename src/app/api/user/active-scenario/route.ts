import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';

/**
 * 시뮬레이터에서 마지막으로 선택한 시나리오를 계정에 기록한다.
 *
 * 읽기는 여기에 없다. GET /api/scenarios가 목록과 함께 돌려준다(그 라우트의 주석 참조).
 */
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { scenarioId } = body;

    if (typeof scenarioId !== 'string' || !scenarioId) {
      return NextResponse.json({ error: 'Missing scenarioId' }, { status: 400 });
    }

    // 로그인 전 화면이나 비로그인 세션이 만든 임시 시나리오다. 서버에는 대응하는 행이 없으므로
    // 400으로 튕기지 않고 조용히 무시한다 — 클라이언트가 보낼 이유는 없지만, 보냈다고 해서
    // 계정에 존재하지 않는 id를 남길 이유도 없다.
    if (scenarioId.startsWith('local-')) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // 소유권 확인. 이 값은 다음 로그인에서 그대로 선택되므로, 남의 시나리오 id를 심어 두면
    // 사용자가 자기 계정에서 열 수 없는 항목을 계속 가리키게 된다.
    const scenario = await prisma.scenario.findUnique({
      where: { id: scenarioId },
      select: { userId: true },
    });

    if (!scenario || scenario.userId !== session.user.id) {
      return NextResponse.json({ error: 'Scenario not found or access denied' }, { status: 404 });
    }

    // update가 아니라 updateMany인 이유: 행이 없으면 update는 P2025로 던진다. 세션 전략이
    // jwt라 탈퇴한 계정의 쿠키가 만료까지 살아 있으므로, 없는 행을 만들지 않고 401로 답한다.
    const { count } = await prisma.user.updateMany({
      where: { id: session.user.id },
      data: { lastActiveScenarioId: scenarioId },
    });

    if (count === 0) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error updating active scenario:', error);
    return NextResponse.json({ error: 'Failed to update active scenario' }, { status: 500 });
  }
}
