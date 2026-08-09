import nodemailer from 'nodemailer';

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export const sendVerificationEmail = async (email: string, token: string) => {
  const transporter = createTransporter();

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
  const transporter = createTransporter();

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

export const sendSecurityKeyEmail = async (email: string, key: string) => {
  const transporter = createTransporter();

  return transporter.sendMail({
    from: `"NextLife" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: '[NextLife] 보안키를 안전하게 보관해 주세요',
    text: `NextLife 보안키: ${key}\n\n이 보안키는 로그인과 자산 데이터 암호화에 사용됩니다. 보안키를 분실하면 저장된 데이터를 복구할 수 없습니다. 이메일을 삭제하지 말고 안전하게 보관해 주세요.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
        <h2>NextLife 보안키</h2>
        <p>아래 보안키는 <strong>로그인과 자산 데이터 암호화</strong>에 사용됩니다.</p>
        <div style="margin: 28px 0; padding: 20px; border-radius: 10px; background: #f3f4f6; text-align: center; font-family: monospace; font-size: 30px; font-weight: 700; letter-spacing: 0.3em;">${key}</div>
        <p style="color: #b42318;"><strong>중요:</strong> 보안키를 분실하면 저장된 자산 데이터를 복구할 수 없습니다.</p>
        <p>이 이메일을 삭제하지 말고 본인만 접근할 수 있는 곳에 안전하게 보관해 주세요. NextLife는 보안키 원문을 서버에 저장하지 않습니다.</p>
      </div>
    `,
  });
};

export const sendEmailMigrationCode = async (email: string, code: string) => {
  const transporter = createTransporter();

  return transporter.sendMail({
    from: `"NextLife" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: '[NextLife] 이메일 로그인 전환 인증번호',
    text: `이메일 로그인 전환 인증번호: ${code}\n\n인증번호는 10분 동안 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시해 주세요.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
        <h2>이메일 로그인 전환</h2>
        <p>아래 인증번호를 NextLife 전환 화면에 입력해 주세요.</p>
        <div style="margin: 28px 0; padding: 20px; border-radius: 10px; background: #f3f4f6; text-align: center; font-family: monospace; font-size: 30px; font-weight: 700; letter-spacing: 0.3em;">${code}</div>
        <p>인증번호는 10분 동안 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시해 주세요.</p>
      </div>
    `,
  });
};
