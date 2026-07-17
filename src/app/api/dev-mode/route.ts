import { NextResponse } from 'next/server';

export async function GET() {
  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';
  return NextResponse.json({ isDevMode });
}
