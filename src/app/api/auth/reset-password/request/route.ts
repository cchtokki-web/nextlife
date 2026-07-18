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

    // 가입 여부와 무관하게 동일한 응답을 반환해 이메일 가입 여부가 노출(user enumeration)되지 않도록 한다.
    if (user) {
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
    }

    return NextResponse.json(
      { message: "가입된 이메일이라면 비밀번호 재설정 링크가 발송되었습니다." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Password reset request error:", error);
    return NextResponse.json({ error: "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
