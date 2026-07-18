import { NextResponse } from 'next/server';
import { isDevMode } from '@/core/utils/isDevMode';

export async function GET() {
  return NextResponse.json({ isDevMode: isDevMode() });
}
