import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/db/prisma';

// 클라이언트(admin/page.tsx)가 이 응답 셰이프를 import해서 쓰도록 export한다 — 라우트 응답이
// 바뀌었는데 클라이언트 타입은 그대로인 채 어긋나는 것을 컴파일 타임에 잡기 위함.
export interface AdminStatsPeriod {
  visitors: number;
  simulationRuns: number;
}

export interface AdminStatsResponse {
  success: true;
  stats: {
    daily: AdminStatsPeriod;
    weekly: AdminStatsPeriod;
    monthly: AdminStatsPeriod;
    yearly: AdminStatsPeriod;
  };
}

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

    // authHeader.split(' ')[1]은 "Bearer  x"처럼 중간에 공백이 더 있으면 빈 문자열을 토큰으로
    // 뽑아내, ADMIN_KEY가 빈 문자열로 설정된 배포에서 인증을 우회할 수 있었다. slice로
    // "Bearer " 접두사만 정확히 제거하고, ADMIN_KEY 자체가 비어있으면 무조건 거부한다.
    const token = authHeader.slice('Bearer '.length);
    if (!process.env.ADMIN_KEY || token !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
