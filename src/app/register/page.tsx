import RegisterForm from "@/web/features/auth/RegisterForm";
import { isDevMode } from "@/core/utils/isDevMode";
import { redirect } from "next/navigation";

export default function RegisterPage() {
  if (isDevMode()) redirect('/simulator');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <RegisterForm />
    </div>
  );
}
