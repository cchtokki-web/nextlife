import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/db/prisma';

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as start of week
  d.setDate(diff);
  return d;
}

function getStartOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfYear() {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    if (token !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date();
    const today = getStartOfToday();
    const thisWeek = getStartOfWeek();
    const thisMonth = getStartOfMonth();
    const thisYear = getStartOfYear();

    // Utility to count unique sessions for visitors and total events for simulations
    const getStatsForDate = async (gteDate: Date) => {
      const visitors = await prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: {
          type: 'VISIT',
          createdAt: {
            gte: gteDate,
          },
          sessionId: {
            not: null,
          }
        },
      });

      const simulationRuns = await prisma.analyticsEvent.count({
        where: {
          type: 'SIMULATION_RUN',
          createdAt: {
            gte: gteDate,
          },
        },
      });

      return {
        visitors: visitors.length,
        simulationRuns,
      };
    };

    const daily = await getStatsForDate(today);
    const weekly = await getStatsForDate(thisWeek);
    const monthly = await getStatsForDate(thisMonth);
    const yearly = await getStatsForDate(thisYear);

    return NextResponse.json({
      success: true,
      stats: {
        daily,
        weekly,
        monthly,
        yearly,
      }
    });

  } catch (error) {
    console.error('Failed to fetch admin stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
