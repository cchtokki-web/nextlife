import RegisterForm from "@/web/features/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <RegisterForm />
    </div>
  );
}
