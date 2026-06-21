import LoginForm from "@/web/features/auth/LoginForm";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/core/utils/authOptions";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const session = await getServerSession(authOptions);
  
  if (session) {
    redirect("/");
  }

  const error = searchParams?.error as string | undefined;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', flexDirection: 'column' }}>
      {error && (
        <div style={{ color: '#ff4d4f', marginBottom: '1rem', padding: '1rem', border: '1px solid #ff4d4f', borderRadius: '8px', backgroundColor: 'rgba(255,77,79,0.1)', textAlign: 'center' }}>
          <strong>로그인 오류 발생</strong><br />
          <small>{error}</small>
        </div>
      )}
      <LoginForm />
    </div>
  );
}
