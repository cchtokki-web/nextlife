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
    async jwt({ token, user, account }) {
      if (account) {
        token.provider = account.provider;
      }
      if (user) {
        token.id = user.id;
        token.tier = (user as any).tier || 'basic';
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
        if (url.startsWith("/")) return url;
        try {
          const parsedUrl = new URL(url);
          return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
        } catch (e) {
          return "/";
        }
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
