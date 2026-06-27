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

    let user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { scenarios: { orderBy: { createdAt: 'asc' } } },
    });

    if (!user && process.env.NEXT_PUBLIC_DEV_MODE === "true" && session.user.email === 'dev@example.com') {
      // Auto-create dev user in database to support scenarios in dev mode
      user = await prisma.user.create({
        data: {
          id: 'dev-user-id',
          email: 'dev@example.com',
          name: 'Dev User',
          tier: 'premium'
        },
        include: { scenarios: { orderBy: { createdAt: 'asc' } } },
      });
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let scenarios = user.scenarios;

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

    return NextResponse.json({ data: formattedScenarios }, { status: 200 });
  } catch (error: any) {
    console.error('Error fetching scenarios:', error);
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user && process.env.NEXT_PUBLIC_DEV_MODE === "true" && session.user.email === 'dev@example.com') {
      user = await prisma.user.create({
        data: {
          id: 'dev-user-id',
          email: 'dev@example.com',
          name: 'Dev User',
          tier: 'premium'
        }
      });
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const { name, data, isDefault = false } = body;

    if (!name || !data) {
      return NextResponse.json({ error: 'Missing name or data' }, { status: 400 });
    }

    const newScenario = await prisma.scenario.create({
      data: {
        userId: user.id,
        name,
        isDefault,
        data: JSON.stringify(data),
      },
    });

    return NextResponse.json(
      { data: { ...newScenario, data: JSON.parse(newScenario.data) } },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating scenario:', error);
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 });
  }
}
