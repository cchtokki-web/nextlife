import LoginForm from "@/web/features/auth/LoginForm";

export default function LoginPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <LoginForm />
    </div>
  );
}
