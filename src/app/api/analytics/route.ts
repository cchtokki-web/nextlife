import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/db/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, sessionId } = body;

    if (!type || !['VISIT', 'SIMULATION_RUN'].includes(type)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }

    if (type === 'VISIT' && !sessionId) {
      return NextResponse.json({ error: 'sessionId required for VISIT event' }, { status: 400 });
    }

    // For VISIT events, we might want to check if the session already exists today
    // to prevent duplicate counts, but for simplicity we log everything and group by sessionId later,
    // or we just rely on the frontend sending only once per session.
    await prisma.analyticsEvent.create({
      data: {
        type,
        sessionId: sessionId || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to log analytics event:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
