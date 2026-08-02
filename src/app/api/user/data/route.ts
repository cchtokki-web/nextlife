import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';

export async function GET(req: Request) {
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

    // upsert인 이유: 개발 모드 세션은 DB에 행이 없는 채로 발급되므로 update만으로는 저장이
    // 항상 실패한다.
    //
    // create의 tier는 Prisma 스키마 기본값과 같은 'basic'이어야 한다. 세션 전략이 jwt라
    // DB 행이 없어도 토큰은 만료까지 유효한데, tier가 없던 시절의 토큰을 가진 사용자가
    // 저장을 한 번 호출하는 것만으로 상위 등급 계정이 생기면 안 된다.
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

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error updating simulation data:', error);
    return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
  }
}
