import { Suspense } from "react";
import ResetPasswordForm from "@/web/features/auth/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <Suspense fallback={<div className="glass" style={{ padding: '2rem', textAlign: 'center' }}>로딩 중...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
