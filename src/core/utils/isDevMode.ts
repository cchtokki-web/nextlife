// NODE_ENV=development에서는 로그인 없이 사용할 수 있도록 개발 모드를 자동 활성화한다.
// 다른 비프로덕션 환경에서는 명시적인 NEXT_PUBLIC_DEV_MODE=true가 필요하다.
// 이 함수는 자격증명 검사 우회와 개발 세션을 켜므로 NODE_ENV=production에서는 항상 꺼 둔다.
export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
    && (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_MODE === 'true');
}
