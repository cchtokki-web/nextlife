import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "@/infrastructure/db/prisma";
import { isDevMode } from "@/core/utils/isDevMode";
import { isRateLimited } from "@/core/utils/rateLimiter";

if (isDevMode()) {
  process.env.NEXTAUTH_URL = process.env.DEV_NEXTAUTH_URL || "http://localhost:3000";
}

// 개발 모드에서 로그인 후 돌아갈 origin.
//
// NEXTAUTH_URL(=redirect 콜백의 baseUrl)을 그대로 쓸 수 없다. 그 값은 모듈 로드 시점에 한 번
// 정해지는데(위 기본값 http://localhost:3000) dev 서버를 다른 포트로 띄우는 일이 흔하고,
// 그러면 로그인할 때마다 죽은 포트로 튕긴다.
//
// next dev는 실제로 바인딩한 포트를 process.env.PORT에 넣어 준다(next/dist/server/lib/
// start-server.js). 그 값은 요청 시점에는 반드시 채워져 있으므로 여기서 읽는다.
function resolveDevOrigin(baseUrl: string): string {
  // 명시적으로 지정했으면 그 값이 이긴다 — 터널이나 호스트 별칭을 쓰는 경우 포트 추론이
  // 사용자의 지정을 덮으면 안 된다.
  const explicit = process.env.DEV_NEXTAUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const port = process.env.PORT;
  return port ? `http://localhost:${port}` : baseUrl;
}

// 같은 출처의 경로만 남긴다. 절대 URL이면 경로만 떼어 내고, 파싱되지 않으면 루트로 보낸다.
//
// 프로토콜 상대 URL(`//evil.com`)은 여기서 걸러내지 않아도 앞에 origin이 붙으므로
// 같은 출처의 경로가 된다. 다만 그 형태를 그대로 두면 읽는 사람이 매번 안전성을 다시
// 따져야 하므로 루트로 보낸다(resolveDevCallbackUrl이 클라이언트에서 쓰는 것과 같은 규칙).
function sameOriginPath(url: string): string {
  if (/^\/(?![/\\])/.test(url)) return url;
  if (url.startsWith("/")) return "/";
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

export const authOptions: NextAuthOptions = {
  useSecureCookies: isDevMode() ? false : undefined,
  cookies: isDevMode()
    ? {
        sessionToken: {
          name: `next-auth.session-token`,
          options: {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            secure: false,
          },
        },
        callbackUrl: {
          name: `next-auth.callback-url`,
          options: {
            sameSite: "lax",
            path: "/",
            secure: false,
          },
        },
        csrfToken: {
          name: `next-auth.csrf-token`,
          options: {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            secure: false,
          },
        },
      }
    : undefined,
  providers: [
    CredentialsProvider({
      name: "이메일 로그인",
      credentials: {
        email: { label: "이메일", type: "email", placeholder: "example@example.com" },
        securityKey: { label: "보안키", type: "password" },
      },
      async authorize(credentials) {
        if (isDevMode()) {
          return {
            id: "dev-user-id",
            email: "dev@example.com",
            name: "Dev User",
            tier: "premium"
          };
        }

        const email = credentials?.email?.trim().toLowerCase();
        const securityKey = credentials?.securityKey?.trim().toUpperCase();

        if (!email || !securityKey) {
          throw new Error("이메일과 보안키를 모두 입력해 주세요.");
        }

        if (securityKey && isRateLimited(`security-key-login:${email}`, 5, 30 * 1000)) {
          throw new Error("보안키를 너무 많이 잘못 입력했습니다. 30초 후 다시 시도해 주세요.");
        }

        const user = await prisma.user.findUnique({
          where: { email }
        });

        if (!user) {
          throw new Error("가입되지 않은 이메일이거나 보안키가 올바르지 않습니다.");
        }

        const isSecurityKeyValid = Boolean(
          securityKey
          && user.securityKeyHash
          && await bcrypt.compare(securityKey, user.securityKeyHash),
        );
        if (!isSecurityKeyValid) {
          throw new Error("가입되지 않은 이메일이거나 보안키가 올바르지 않습니다.");
        }

        // 메일로만 전달된 보안키를 맞게 입력한 순간 이메일 소유 확인도 완료된다.
        if (isSecurityKeyValid && !user.emailVerified) {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: new Date() },
          });
        }


        // 재발급 요청만으로는 데이터를 지우지 않는다. 이메일로 받은 새 키를 맞게 입력해
        // 이메일 소유가 확인된 이 순간에만 삭제하며, 두 변경은 한 트랜잭션으로 묶는다.
        if (isSecurityKeyValid && user.securityKeyResetPending) {
          await prisma.$transaction([
            prisma.scenario.deleteMany({ where: { userId: user.id } }),
            prisma.user.update({
              where: { id: user.id },
              data: {
                securityKeyResetPending: false,
                simulationData: null,
                e2eeEnabledAt: null,
              },
            }),
            prisma.verificationToken.deleteMany({ where: { identifier: email } }),
          ]);
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tier: user.tier,
        };
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tier = user.tier || 'basic';
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        if (token.tier) {
          session.user.tier = token.tier as string;
        }
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (isDevMode()) {
        // **반드시 절대 URL을 돌려준다.** next-auth 클라이언트의 signIn()이 응답의 url을
        // `new URL(...)`로 파싱하므로, 상대 경로를 주면 거기서 TypeError가 나고 개발 모드
        // 자동 로그인이 "자동 로그인 중 오류가 발생했습니다" 화면에 멈춘다 — 서버 측 인증은
        // 정상인데(HTTP 200) 브라우저에서 진입이 통째로 막힌다.
        //
        // 예전에는 상대 경로를 돌려줬다. 그 의도는 옳았다 — dev 서버 포트가 NEXTAUTH_URL과
        // 다를 때 baseUrl을 그대로 쓰면 로그인 후 죽은 포트로 튕기기 때문이다. 그래서 의도는
        // 유지하되(경로만 취한다) origin을 resolveDevOrigin으로 실제 포트에 맞춘다.
        return `${resolveDevOrigin(baseUrl)}${sameOriginPath(url)}`;
      }
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    }
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: isDevMode(),
};
