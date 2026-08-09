import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/infrastructure/db/prisma";
import { sendSecurityKeyEmail } from "@/core/utils/emailSender";
import { generateSecurityKey } from "@/core/utils/securityKey";
import { isRateLimited } from "@/core/utils/rateLimiter";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const confirmReset = body.confirmReset === true;

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "올바른 이메일 주소를 입력해 주세요." }, { status: 400 });
    }

    if (isRateLimited(`register:${email}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser && !confirmReset) {
      return NextResponse.json({
        error: "이미 등록된 이메일입니다. 계정을 초기화하면 기존 시나리오가 모두 삭제됩니다.",
        code: "ACCOUNT_RESET_REQUIRED",
      }, { status: 409 });
    }

    const securityKey = generateSecurityKey();
    const securityKeyHash = await bcrypt.hash(securityKey, 12);

    try {
      await sendSecurityKeyEmail(email, securityKey);
    } catch {
      // 메일 전달이 확인되기 전에는 기존 계정의 키와 데이터에 손대지 않는다.
      throw new Error('security key email failed');
    }

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          securityKeyHash,
          securityKeyResetPending: true,
          emailVerified: null,
        },
      });
      return NextResponse.json({
        message: "새 보안키를 이메일로 보냈습니다. 새 키로 로그인하면 기존 시나리오가 모두 초기화됩니다.",
        resetPending: true,
      });
    }

    await prisma.user.create({ data: { email, securityKeyHash } });
    return NextResponse.json({ message: "입력하신 이메일로 보안키를 보냈습니다." }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "회원가입 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
