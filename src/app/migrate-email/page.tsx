import EmailMigrationForm from '@/web/features/auth/EmailMigrationForm';

export default function MigrateEmailPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <EmailMigrationForm />
    </div>
  );
}
