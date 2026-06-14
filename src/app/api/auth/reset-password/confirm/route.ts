import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/infrastructure/db/prisma";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ error: "토큰과 새 비밀번호는 필수입니다." }, { status: 400 });
    }

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!verificationToken) {
      return NextResponse.json({ error: "유효하지 않은 토큰입니다." }, { status: 400 });
    }

    if (verificationToken.expires < new Date()) {
      return NextResponse.json({ error: "만료된 토큰입니다. 다시 시도해주세요." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { email: verificationToken.identifier },
      data: { passwordHash },
    });

    await prisma.verificationToken.delete({
      where: { token },
    });

    return NextResponse.json({ message: "비밀번호가 성공적으로 변경되었습니다." }, { status: 200 });
  } catch (error) {
    console.error("Password reset confirm error:", error);
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
