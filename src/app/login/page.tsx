import LoginForm from "@/web/features/auth/LoginForm";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/core/utils/authOptions";
import { redirect } from "next/navigation";

// searchParams는 Promise다. 동기로 읽으면 Next가 런타임 에러를 던지고 그 값은 undefined로
// 남는다 — 즉 로그인에 실패해도 아래 오류 배너가 **한 번도 뜨지 않는다**.
// 타입에 Promise를 명시해야 await를 빠뜨리는 실수가 컴파일 타임에 걸린다.
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/");
  }

  // 같은 키가 여러 번 오면 배열이 된다(예: ?error=a&error=b). 배열을 그대로 렌더하면
  // "a,b"처럼 보이므로 첫 값만 쓴다. 예전에는 `as string`으로 단언만 하고 있었다.
  const params = await searchParams;
  const errorParam = params?.error;
  const error = Array.isArray(errorParam) ? errorParam[0] : errorParam;

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
