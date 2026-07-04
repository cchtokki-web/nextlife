import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !(session.user as any).id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[API] GET scenarios session:', JSON.stringify(session));

    const userId = (session.user as any).id;

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
          tier: (session.user as any).tier || 'basic'
        },
        include: { scenarios: { orderBy: { createdAt: 'asc' } } },
      });
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

    if (!session || !session.user || !(session.user as any).id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = (session.user as any).id;

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
          tier: (session.user as any).tier || 'basic'
        }
      });
    }

    const body = await req.json();
    const { name, data, isDefault = false } = body;

    if (!name || !data) {
      return NextResponse.json({ error: 'Missing name or data' }, { status: 400 });
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

    return NextResponse.json(
      { data: { ...newScenario, data: JSON.parse(newScenario.data) } },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating scenario:', error);
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 });
  }
}
