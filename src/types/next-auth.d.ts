import "next-auth";

declare module "next-auth" {
  // authorize()/OAuth 프로필이 돌려주는 사용자. jwt 콜백이 token.tier를 채울 때 읽는다.
  interface User {
    tier?: string;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      provider?: string | null;
      tier?: string;
    };
  }
}
