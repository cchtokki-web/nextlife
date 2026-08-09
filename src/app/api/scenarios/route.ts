import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { markE2eeEnabled } from '@/infrastructure/db/e2ee';
import { isEncryptedPayload } from '@/core/utils/crypto';

export async function GET(_req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: { scenarios: { orderBy: { createdAt: 'asc' } } },
    });

    if (!user) {
      // Auto-recreate user record in the database if it is missing (e.g. database reset/clean)
      user = await prisma.user.create({
        data: {
          id: userId,
          email: session.user.email || null,
          name: session.user.name || null,
          tier: session.user.tier || 'basic'
        },
        include: { scenarios: { orderBy: { createdAt: 'asc' } } },
      });
    }

    let scenarios = user.scenarios;

    // Cleanup duplicate default scenarios (keep the oldest, delete the newer duplicates)
    const defaultScenarios = scenarios.filter(s => s.isDefault);
    if (defaultScenarios.length > 1) {
      const [, ...duplicates] = defaultScenarios;
      const duplicateIds = duplicates.map(d => d.id);
      await prisma.scenario.deleteMany({
        where: {
          id: { in: duplicateIds }
        }
      });
      scenarios = scenarios.filter(s => !duplicateIds.includes(s.id));
    }

    // Legacy data migration: If no scenarios exist, but there is simulationData, create a default scenario
    if (scenarios.length === 0 && user.simulationData) {
      const defaultScenario = await prisma.scenario.create({
        data: {
          userId: user.id,
          name: '기본 시나리오',
          isDefault: true,
          data: user.simulationData,
        },
      });
      scenarios = [defaultScenario];
    }

    // Format output
    const formattedScenarios = scenarios.map(s => ({
      id: s.id,
      name: s.name,
      isDefault: s.isDefault,
      data: JSON.parse(s.data),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    // 암호문이 하나라도 있으면 이 계정은 잠겨 있는 것이다. 플래그가 아직 없는 기존 계정을
    // 여기서 소급해 세운다 — 첫 쓰기를 기다리면, 그 전에 다른 브라우저가 키 없이 열 수 있다.
    const hasCiphertext = formattedScenarios.some(s => isEncryptedPayload(s.data));
    if (hasCiphertext && !user.e2eeEnabledAt) {
      await markE2eeEnabled(user.id);
    }
    const e2eeEnabled = Boolean(user.e2eeEnabledAt) || hasCiphertext;

    return NextResponse.json({ data: formattedScenarios, e2eeEnabled }, { status: 200 });
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      // Auto-recreate user record in the database if it is missing (e.g. database reset/clean)
      user = await prisma.user.create({
        data: {
          id: userId,
          email: session.user.email || null,
          name: session.user.name || null,
          tier: session.user.tier || 'basic'
        }
      });
    }

    const body = await req.json();
    const { name, data, isDefault = false } = body;

    if (!name || !data) {
      return NextResponse.json({ error: 'Missing name or data' }, { status: 400 });
    }

    // 잠긴 계정에 평문을 쓰려는 요청은 거부한다. 클라이언트도 막지만, 클라이언트만 막으면
    // 배포 전 번들이 열려 있는 탭·아직 새로고침하지 않은 다른 기기·세션 쿠키를 가진 요청이
    // 전부 우회한다. 플래그를 들고 있는 서버가 이 불변식을 지킬 수 있는 유일한 지점이다.
    const encrypted = isEncryptedPayload(data);
    if (!encrypted && user.e2eeEnabledAt) {
      console.error('[E2EE] Rejected plaintext scenario create for locked account', user.id);
      return NextResponse.json(
        { error: '이 계정은 보안키로 잠겨 있어 암호화되지 않은 데이터를 저장할 수 없습니다.' },
        { status: 409 }
      );
    }

    if (isDefault) {
      const existingDefault = await prisma.scenario.findFirst({
        where: {
          userId: user.id,
          isDefault: true,
        },
      });

      if (existingDefault) {
        const updatedScenario = await prisma.scenario.update({
          where: { id: existingDefault.id },
          data: {
            data: JSON.stringify(data),
          },
        });
        if (encrypted) await markE2eeEnabled(user.id);
        return NextResponse.json(
          { data: { ...updatedScenario, data: JSON.parse(updatedScenario.data) } },
          { status: 200 }
        );
      }
    }

    const newScenario = await prisma.scenario.create({
      data: {
        userId: user.id,
        name,
        isDefault,
        data: JSON.stringify(data),
      },
    });

    // 쓰기가 성공한 뒤에 세운다. 먼저 세우면 쓰기가 실패했을 때 "플래그는 섰는데 암호문은
    // 없는" 계정이 남고, 그 상태에서는 맞는 키도 검증할 수 없다.
    if (encrypted) await markE2eeEnabled(user.id);

    return NextResponse.json(
      { data: { ...newScenario, data: JSON.parse(newScenario.data) } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating scenario:', error);
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 });
  }
}
