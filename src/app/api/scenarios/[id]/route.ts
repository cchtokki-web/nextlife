import { NextResponse } from 'next/server';
import { getAppSession } from '@/core/utils/getAppSession';
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/db/prisma';
import { markE2eeEnabled } from '@/infrastructure/db/e2ee';
import { isEncryptedPayload } from '@/core/utils/crypto';
import { parseCompareScenarioIds } from '@/core/utils/compareScenarios';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAppSession();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify ownership
    const existingScenario = await prisma.scenario.findUnique({
      where: { id },
    });

    if (!existingScenario || existingScenario.userId !== user.id) {
      return NextResponse.json({ error: 'Scenario not found or access denied' }, { status: 404 });
    }

    const body = await req.json();
    const { name, data, isDefault, analyzed, analyzedParamsHash } = body;

    // 잠긴 계정에 평문을 쓰려는 요청은 거부한다. 클라이언트도 막지만, 클라이언트만 막으면
    // 배포 전 번들이 열려 있는 탭·아직 새로고침하지 않은 다른 기기·세션 쿠키를 가진 요청이
    // 전부 우회한다. 플래그를 들고 있는 서버가 이 불변식을 지킬 수 있는 유일한 지점이다.
    //
    // 특히 이 라우트는 본문을 user.simulationData에도 복사하는데(아래), GET의 레거시
    // 마이그레이션이 그것을 다시 시나리오 행으로 되살린다 — 평문 한 번이 두 곳에 남는다.
    const encrypted = data !== undefined && isEncryptedPayload(data);
    if (data !== undefined && !encrypted && user.e2eeEnabledAt) {
      console.error('[E2EE] Rejected plaintext scenario update for locked account', user.id, id);
      return NextResponse.json(
        { error: '이 계정은 보안키로 잠겨 있어 암호화되지 않은 데이터를 저장할 수 없습니다.' },
        { status: 409 }
      );
    }

    const updateData: Prisma.ScenarioUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (data !== undefined) {
      updateData.data = JSON.stringify(data);
    }
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    // 분석 요청이 실행됐다는 사실. 다음 로그인에서 결과 화면을 다시 세울 유일한 근거이며,
    // data를 건드리지 않으므로 위 잠금 판정(encrypted)에도 관여하지 않는다 — 관여하게 두면
    // E2EE를 정상적으로 쓰는 모든 계정에서 이 표시가 409로 막힌다.
    if (analyzed !== undefined) updateData.analyzedAt = analyzed ? new Date() : null;

    // 아래 세 갈래는 셋 다 의도적이다.
    //
    // 1. analyzed:false는 「분석하지 않은 상태」로 되돌리는 요청이므로 해시도 «함께» 지운다.
    //    시각만 지우고 해시를 남기면 다음 분석에서 옛 해시와 비교해 영원히 「재분석 필요」다.
    // 2. 그래서 else가 load-bearing이다. 같은 요청에 해시가 실려 와도 analyzed:false가 이긴다.
    //    두 개의 독립된 if로 펴면 동작이 바뀐다.
    // 3. 키가 «아예 없는» 요청은 기존 값을 유지한다. 자동저장처럼 해시를 모르는 호출이
    //    남의 값을 지우면 안 되기 때문이다. 값을 모른다고 말하려면 null을 명시해야 한다.
    //
    // 형식 검사는 여기서 한다. 검사 없이 Prisma로 넘기면 문자열이 아닌 값이 그 안에서 던져
    // 일반 500이 되는데, 클라이언트는 그것을 "서버가 죽었다"와 구분할 수 없다.
    if (analyzed === false) {
      updateData.analyzedParamsHash = null;
    } else if (analyzedParamsHash !== undefined) {
      const hashIsWellFormed = analyzedParamsHash === null
        || (typeof analyzedParamsHash === 'string' && /^v\d+:[0-9a-f]{8,64}$/.test(analyzedParamsHash));
      if (!hashIsWellFormed) {
        console.error('Rejected malformed analyzedParamsHash for scenario', id, typeof analyzedParamsHash);
        return NextResponse.json({ error: '분석 기록 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      updateData.analyzedParamsHash = analyzedParamsHash;
    }

    const updatedScenario = await prisma.scenario.update({
      where: { id },
      data: updateData,
    });

    // Also update legacy simulationData if this is the default scenario to keep backwards compatibility
    if (updatedScenario.isDefault && updateData.data) {
      await prisma.user.update({
        where: { id: user.id },
        data: { simulationData: updateData.data }
      });
    }

    // 쓰기가 성공한 뒤에 세운다. 먼저 세우면 쓰기가 실패했을 때 "플래그는 섰는데 암호문은
    // 없는" 계정이 남고, 그 상태에서는 맞는 키도 검증할 수 없다.
    if (encrypted) await markE2eeEnabled(user.id);

    return NextResponse.json(
      { data: { ...updatedScenario, data: JSON.parse(updatedScenario.data) } },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating scenario:', error);
    return NextResponse.json({ error: 'Failed to update scenario' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAppSession();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const existingScenario = await prisma.scenario.findUnique({
      where: { id },
    });

    if (!existingScenario || existingScenario.userId !== user.id) {
      return NextResponse.json({ error: 'Scenario not found or access denied' }, { status: 404 });
    }

    if (existingScenario.isDefault) {
      return NextResponse.json({ error: 'Cannot delete the default scenario' }, { status: 400 });
    }

    await prisma.scenario.delete({
      where: { id },
    });

    // 마지막 선택과 비교 목록이 방금 지운 시나리오를 가리키고 있었다면 비운다. 클라이언트도
    // 다른 시나리오로 옮겨 가며 새 값을 올리지만, 그 요청이 실패하거나 사용자가 곧바로 창을
    // 닫으면 계정에는 존재하지 않는 id가 남는다. 지우는 쪽에서 함께 정리해 두면 그 창이 없다.
    //
    // 두 필드를 한 번의 update로 쓴다. 나눠 쓰면 두 번째가 실패했을 때 절반만 정리된 상태가 남는다.
    const cleanup: Prisma.UserUpdateInput = {};
    if (user.lastActiveScenarioId === id) cleanup.lastActiveScenarioId = null;
    const compareIds = parseCompareScenarioIds(user.compareScenarioIds);
    const remainingCompareIds = compareIds.filter(cid => cid !== id);
    if (remainingCompareIds.length !== compareIds.length) {
      cleanup.compareScenarioIds = remainingCompareIds.length > 0
        ? JSON.stringify(remainingCompareIds)
        : null;
    }
    if (Object.keys(cleanup).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: cleanup,
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting scenario:', error);
    return NextResponse.json({ error: 'Failed to delete scenario' }, { status: 500 });
  }
}
