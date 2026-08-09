import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import KakaoProvider from "next-auth/providers/kakao";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcrypt";
import { prisma } from "@/infrastructure/db/prisma";
import { isDevMode } from "@/core/utils/isDevMode";

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
  adapter: PrismaAdapter(prisma),
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
    ...(isDevMode()
      ? []
      : [
          KakaoProvider({
            clientId: process.env.KAKAO_CLIENT_ID || "",
            clientSecret: process.env.KAKAO_CLIENT_SECRET || "",
            authorization: {
              params: {
                scope: "profile_nickname,profile_image,talk_message",
              },
            },
          }),
        ]),
    CredentialsProvider({
      name: "이메일 로그인",
      credentials: {
        email: { label: "이메일", type: "email", placeholder: "example@example.com" },
        password: { label: "비밀번호", type: "password" }
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

        if (!credentials?.email || !credentials?.password) {
          throw new Error("이메일과 비밀번호를 모두 입력해주세요.");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });

        if (!user || !user.passwordHash) {
          throw new Error("가입되지 않은 이메일이거나 비밀번호가 틀렸습니다.");
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash);

        if (!isPasswordValid) {
          throw new Error("가입되지 않은 이메일이거나 비밀번호가 틀렸습니다.");
        }

        if (!user.emailVerified) {
          throw new Error("이메일 인증이 완료되지 않았습니다. 이메일을 확인해주세요.");
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
    async signIn({ account }) {
      // NextAuth v4의 PrismaAdapter는 기존 OAuth Account로 다시 로그인해도 새 토큰을 DB에
      // 반영하지 않는다. 카카오 동의항목을 추가로 승인받아도 여기서 갱신하지 않으면
      // send-backup-key는 계속 예전 access_token을 사용해 -402를 반복한다.
      //
      // 신규 계정은 이 시점에 Account 행이 아직 없어 updateMany가 0건이고, 이어지는
      // PrismaAdapter.linkAccount가 새 토큰으로 행을 만든다. 기존 계정만 이 갱신 대상이다.
      if (account?.provider === 'kakao' && account.providerAccountId) {
        await prisma.account.updateMany({
          where: {
            provider: 'kakao',
            providerAccountId: account.providerAccountId,
          },
          data: {
            ...(account.access_token ? { access_token: account.access_token } : {}),
            // 카카오는 매번 refresh_token을 주지 않는다. 없을 때 undefined/null로 덮으면
            // 다음 access token 만료 뒤에는 복구할 수 없으므로 새 값이 있을 때만 갱신한다.
            ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
            ...(typeof account.expires_at === 'number' ? { expires_at: account.expires_at } : {}),
          },
        });
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account) {
        token.provider = account.provider;
      }
      if (user) {
        token.id = user.id;
        token.tier = user.tier || 'basic';
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        if (token.provider) {
          session.user.provider = token.provider as string;
        }
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
