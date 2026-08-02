import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/db/prisma';

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

    const updateData: Prisma.ScenarioUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (data !== undefined) updateData.data = JSON.stringify(data);
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
