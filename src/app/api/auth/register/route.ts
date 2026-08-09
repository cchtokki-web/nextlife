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

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "올바른 이메일 주소를 입력해 주세요." }, { status: 400 });
    }

    if (isRateLimited(`register:${email}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "이미 가입된 이메일입니다. 이메일 로그인으로 진행해 주세요." }, { status: 409 });
    }

    const securityKey = generateSecurityKey();
    const securityKeyHash = await bcrypt.hash(securityKey, 12);

    const user = await prisma.user.create({
      data: {
        email,
        securityKeyHash,
      },
    });

    try {
      await sendSecurityKeyEmail(email, securityKey);
    } catch (error) {
      // 메일을 받지 못한 미완성 계정을 남기면 같은 이메일로 재시도할 수 없다.
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ message: "입력하신 이메일로 보안키를 보냈습니다." }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "회원가입 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
