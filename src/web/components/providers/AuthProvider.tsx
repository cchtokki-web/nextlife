"use client";

import { SessionProvider } from "next-auth/react";
import { isDevMode } from "@/core/utils/isDevMode";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const mockSession = isDevMode() ? {
    user: {
      id: "dev-mock-id",
      name: "Tokki",
      email: "tokki@dev.local",
      provider: "kakao",
    },
    expires: "9999-12-31T23:59:59.999Z",
  } : undefined;

  return <SessionProvider session={mockSession as any}>{children}</SessionProvider>;
}
