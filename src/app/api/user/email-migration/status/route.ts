import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, securityKeyHash: true, emailMigrationCompletedAt: true },
  });
  if (!user) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({
    required: !user.email || !user.securityKeyHash || !user.emailMigrationCompletedAt,
    email: user.email,
  });
}
