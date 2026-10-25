import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { markE2eeEnabled } from '@/infrastructure/db/e2ee';
import { isEncryptedPayload } from '@/core/utils/crypto';
import { isDevMode } from '@/core/utils/isDevMode';
import { MAX_SCENARIO_COUNT } from '@/core/utils/scenarioLimits';
import { parseCompareScenarioIds } from '@/core/utils/compareScenarios';

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
      // 개발 모드 전용. 개발 세션(dev-user-id)은 DB 행 없이 발급되고, prisma db push나
      // dev.db 삭제로 행이 사라져도 토큰은 계속 유효하다 — 그 편의를 위해 여기서 만든다.
      //
      // 운영에서는 만들지 않는다. 세션 전략이 jwt라 User 행을 지워도 쿠키는 만료까지 살아
      // 있는데, 여기서 되살리면 탈퇴한 계정이 다음 요청 한 번으로 부활한다. 행이 없다는 것은
      // 이 토큰이 더는 유효한 주체를 가리키지 않는다는 뜻이므로 401로 답한다.
      if (!isDevMode()) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
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
      // 결과 화면을 다시 세울지 판단하는 값. 결과 자체는 오지 않는다 — 클라이언트가 위 data로
      // 같은 계산을 다시 돌린다(Scenario.analyzedAt의 스키마 주석 참조).
      analyzedAt: s.analyzedAt,
      // 분석 당시 설정과 현재 설정의 변경 여부만 판정한다. 평문 입력 자체는 반환하지 않는다.
      analyzedParamsHash: s.analyzedParamsHash,
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

    // 마지막 선택과 비교 목록을 목록과 같은 응답으로 돌려준다. 별도 요청으로 나누면 목록이 먼저
    // 도착하는 순간 첫 시나리오가 한 번 선택되어 화면이 깜빡이고, 그 사이의 자동저장이 엉뚱한
    // 시나리오로 나갈 수 있다. 셋은 항상 같이 도착해야 한다 — 비교 목록이 한 커밋 늦게 오면
    // 그 사이에 복원된 분석이 비교 카드 없이 계산되어, 사용자는 비교 대상을 다시 골라야 한다.
    return NextResponse.json(
      {
        data: formattedScenarios,
        e2eeEnabled,
        lastActiveScenarioId: user.lastActiveScenarioId ?? null,
        compareScenarioIds: parseCompareScenarioIds(user.compareScenarioIds),
      },
      { status: 200 }
    );
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
      // 개발 모드 전용. 개발 세션(dev-user-id)은 DB 행 없이 발급되고, prisma db push나
      // dev.db 삭제로 행이 사라져도 토큰은 계속 유효하다 — 그 편의를 위해 여기서 만든다.
      //
      // 운영에서는 만들지 않는다. 세션 전략이 jwt라 User 행을 지워도 쿠키는 만료까지 살아
      // 있는데, 여기서 되살리면 탈퇴한 계정이 다음 요청 한 번으로 부활한다. 행이 없다는 것은
      // 이 토큰이 더는 유효한 주체를 가리키지 않는다는 뜻이므로 401로 답한다.
      if (!isDevMode()) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
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

    // 병합으로 이미 5개를 넘은 계정도 기존 행은 그대로 보존한다. 신규 생성만 막으므로
    // 6개에서 하나를 삭제해 5개가 되어도 더 만들 수 없고, 4개가 된 뒤에만 하나를 추가할 수 있다.
    const scenarioCount = await prisma.scenario.count({ where: { userId: user.id } });
    if (scenarioCount >= MAX_SCENARIO_COUNT) {
      return NextResponse.json(
        { error: `시나리오는 최대 ${MAX_SCENARIO_COUNT}개까지만 생성할 수 있습니다.` },
        { status: 409 },
      );
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
