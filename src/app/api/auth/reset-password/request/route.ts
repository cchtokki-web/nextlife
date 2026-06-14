import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/db/prisma";
import { sendPasswordResetEmail } from "@/core/utils/emailSender";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // 보안을 위해 사용자가 존재하지 않아도 성공 메시지를 반환하는 것이 좋습니다.
      // 하지만 사용자 경험을 위해 여기서는 존재하지 않는다고 알려줍니다.
      return NextResponse.json({ error: "가입되지 않은 이메일입니다." }, { status: 404 });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1시간 후 만료

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    await sendPasswordResetEmail(email, token);

    return NextResponse.json({ message: "비밀번호 재설정 이메일이 발송되었습니다." }, { status: 200 });
  } catch (error) {
    console.error("Password reset request error:", error);
    return NextResponse.json({ error: "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
