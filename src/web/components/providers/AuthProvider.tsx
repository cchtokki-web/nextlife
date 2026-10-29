"use client";

import { SessionProvider } from "next-auth/react";
import { isDevMode } from "@/core/utils/isDevMode";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const mockSession = isDevMode() ? {
    user: {
      id: "dev-user-id",
      name: "Dev User",
      email: "dev@example.com",
      tier: "premium",
    },
    expires: "9999-12-31T23:59:59.999Z",
  } : undefined;

  return (
    <SessionProvider session={mockSession}>
      {children}
    </SessionProvider>
  );
}
