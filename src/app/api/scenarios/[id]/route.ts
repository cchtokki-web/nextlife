import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/db/prisma';
import { markE2eeEnabled } from '@/infrastructure/db/e2ee';
import { isEncryptedPayload } from '@/core/utils/crypto';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

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
    const { name, data, isDefault } = body;

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
    const session = await getServerSession(authOptions);

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

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting scenario:', error);
    return NextResponse.json({ error: 'Failed to delete scenario' }, { status: 500 });
  }
}
