import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getAppSession } from '@/core/utils/getAppSession';
import { prisma } from '@/infrastructure/db/prisma';
import { MAX_COMPARE_SCENARIO_COUNT } from '@/core/utils/compareScenarios';

/**
 * 시뮬레이터의 시나리오 선택 상태를 계정에 기록한다 — 지금 보고 있는 시나리오와, 함께 비교
 * 중인 시나리오 목록.
 *
 * 둘 다 결과 화면을 바꾸는 사용자 결정이고, 로그인은 브라우저가 아니라 계정 단위의 사건이다.
 * 그래서 두 값 모두 브라우저가 아니라 계정에 붙어 있어야 다른 기기에서 로그인해도 같은 화면이
 * 이어진다. 한 라우트에 둔 이유도 같다 — 같은 성격의 값이고, 한 번의 요청으로 함께 써야
 * 절반만 반영된 상태가 남지 않는다.
 *
 * 읽기는 여기에 없다. GET /api/scenarios가 목록과 함께 돌려준다(그 라우트의 주석 참조).
 */
export async function PUT(req: Request) {
  try {
    const session = await getAppSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await req.json();
    const { scenarioId, compareScenarioIds } = body;

    const hasScenarioId = scenarioId !== undefined;
    const hasCompareIds = compareScenarioIds !== undefined;
    if (!hasScenarioId && !hasCompareIds) {
      return NextResponse.json({ error: 'Missing scenarioId or compareScenarioIds' }, { status: 400 });
    }

    const data: Prisma.UserUpdateInput = {};

    if (hasScenarioId) {
      if (typeof scenarioId !== 'string' || !scenarioId) {
        return NextResponse.json({ error: 'Missing scenarioId' }, { status: 400 });
      }
      // 로그인 전 화면이나 비로그인 세션이 만든 임시 시나리오다. 서버에는 대응하는 행이 없으므로
      // 400으로 튕기지 않고 조용히 무시한다 — 클라이언트가 보낼 이유는 없지만, 보냈다고 해서
      // 계정에 존재하지 않는 id를 남길 이유도 없다.
      if (!scenarioId.startsWith('local-')) {
        // 소유권 확인. 이 값은 다음 로그인에서 그대로 선택되므로, 남의 시나리오 id를 심어 두면
        // 사용자가 자기 계정에서 열 수 없는 항목을 계속 가리키게 된다.
        const scenario = await prisma.scenario.findUnique({
          where: { id: scenarioId },
          select: { userId: true },
        });

        if (!scenario || scenario.userId !== userId) {
          return NextResponse.json({ error: 'Scenario not found or access denied' }, { status: 404 });
        }

        data.lastActiveScenarioId = scenarioId;
      }
    }

    if (hasCompareIds) {
      if (!Array.isArray(compareScenarioIds)
        || compareScenarioIds.some((id: unknown) => typeof id !== 'string' || !id)) {
        return NextResponse.json({ error: 'Invalid compareScenarioIds' }, { status: 400 });
      }

      const ids = (compareScenarioIds as string[]).filter(id => !id.startsWith('local-'));

      // 차트 범례와 색상이 이 수를 전제로 한다. 한도를 넘겨 저장해 두면 다음 로그인에서
      // 화면이 깨진 채로 복원된다.
      if (ids.length > MAX_COMPARE_SCENARIO_COUNT) {
        return NextResponse.json({ error: 'Too many compareScenarioIds' }, { status: 400 });
      }

      if (ids.length > 0) {
        const owned = await prisma.scenario.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true },
        });
        if (owned.length !== new Set(ids).size) {
          return NextResponse.json({ error: 'Scenario not found or access denied' }, { status: 404 });
        }
      }

      // 순서를 그대로 보존한다 — 사용자가 고른 순서대로 비교 카드가 늘어선다.
      data.compareScenarioIds = ids.length > 0 ? JSON.stringify(ids) : null;
    }

    // local- 임시 id만 담긴 요청. 쓸 것이 없으므로 성공으로 답하고 끝낸다.
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // update가 아니라 updateMany인 이유: 행이 없으면 update는 P2025로 던진다. 세션 전략이
    // jwt라 탈퇴한 계정의 쿠키가 만료까지 살아 있으므로, 없는 행을 만들지 않고 401로 답한다.
    const { count } = await prisma.user.updateMany({
      where: { id: userId },
      data,
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
