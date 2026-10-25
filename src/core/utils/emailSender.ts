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
