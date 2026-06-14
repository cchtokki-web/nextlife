import nodemailer from 'nodemailer';

export const sendVerificationEmail = async (email: string, token: string) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  const verificationUrl = `${process.env.NEXTAUTH_URL}/verify-email?token=${token}`;

  const info = await transporter.sendMail({
    from: `"NextLife" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: "이메일 인증을 완료해주세요",
    html: `
      <div>
        <h2>이메일 인증</h2>
        <p>아래 링크를 클릭하여 이메일 인증을 완료해주세요.</p>
        <a href="${verificationUrl}">인증하기</a>
        <p>또는 다음 주소를 브라우저에 복사하여 붙여넣으세요: <br /> ${verificationUrl}</p>
      </div>
    `,
  });

  return info;
};

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;

  const info = await transporter.sendMail({
    from: `"NextLife" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: "비밀번호 재설정 안내",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">비밀번호 재설정</h2>
        <p>안녕하세요,</p>
        <p>계정의 비밀번호를 재설정하려면 아래 링크를 클릭하세요.</p>
        <div style="margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">비밀번호 재설정하기</a>
        </div>
        <p>또는 다음 주소를 브라우저에 복사하여 붙여넣으세요:</p>
        <p style="word-break: break-all; color: #666; background-color: #f5f5f5; padding: 10px; border-radius: 4px;">${resetUrl}</p>
        <p style="margin-top: 30px; font-size: 14px; color: #888;">본인이 요청하지 않으셨다면 이 이메일을 무시하셔도 됩니다.</p>
      </div>
    `,
  });

  return info;
};
