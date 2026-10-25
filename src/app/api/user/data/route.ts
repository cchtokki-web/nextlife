import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { isDevMode } from '@/core/utils/isDevMode';

export async function GET(_req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { simulationData: true },
    });

    if (!user || !user.simulationData) {
      return NextResponse.json({ data: null }, { status: 200 });
    }

    // Attempt to parse the JSON string back into an object
    const data = JSON.parse(user.simulationData);

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching simulation data:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    
    // Store as JSON string in the database
    const simulationDataString = JSON.stringify(body);

    // upsert는 개발 모드 전용이다. 원래 이걸 쓴 이유가 "개발 모드 세션은 DB에 행이 없는 채로
    // 발급되므로 update만으로는 저장이 항상 실패한다"였고, 그 이유는 운영에 해당하지 않는다.
    //
    // 운영에서 행을 만들면 안 되는 이유: 세션 전략이 jwt라 User 행을 지워도 쿠키는 만료까지
    // 살아 있는데, 여기서 되살리면 탈퇴한 계정이 저장 한 번으로 부활한다.
    if (isDevMode()) {
      // create의 tier는 Prisma 스키마 기본값과 같은 'basic'이어야 한다. tier가 없던 시절의
      // 토큰을 가진 사용자가 저장을 한 번 호출하는 것만으로 상위 등급 계정이 생기면 안 된다.
      // id도 넣지 않는다 — 고정 리터럴을 쓰면 두 번째 생성에서 PK가 충돌한다.
      await prisma.user.upsert({
        where: { email: session.user.email },
        update: { simulationData: simulationDataString },
        create: {
          email: session.user.email,
          name: session.user.name || 'Dev User',
          tier: session.user.tier || 'basic',
          simulationData: simulationDataString,
        },
      });
    } else {
      // update가 아니라 updateMany인 이유: 행이 없으면 update는 P2025로 던진다.
      // count로 받아 401로 답한다.
      const { count } = await prisma.user.updateMany({
        where: { email: session.user.email },
        data: { simulationData: simulationDataString },
      });
      if (count === 0) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error updating simulation data:', error);
    return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
  }
}
