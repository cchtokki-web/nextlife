import LoginForm from "@/web/features/auth/LoginForm";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/core/utils/authOptions";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  
  if (session) {
    redirect("/");
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <LoginForm />
    </div>
  );
}
