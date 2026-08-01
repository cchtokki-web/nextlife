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
  } catch (error: any) {
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
    const userId = (session.user as any).id || 'dev-user-id';

    await prisma.user.upsert({
      where: { email: session.user.email },
      update: { simulationData: simulationDataString },
      create: {
        id: userId,
        email: session.user.email,
        name: session.user.name || 'Dev User',
        tier: (session.user as any).tier || 'premium',
        simulationData: simulationDataString,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Error updating simulation data:', error);
    return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
  }
}
