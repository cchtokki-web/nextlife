// 개발 모드 여부. authOptions가 이 값으로 자격증명 검사를 통째로 건너뛰고(아무 이메일·보안키나
// premium 계정으로 로그인), 쿠키 secure 플래그를 내리고,
// NEXTAUTH_URL을 localhost로 덮어쓴다.
//
// NEXT_PUBLIC_DEV_MODE 하나만 보면 안 된다. NEXT_PUBLIC_ 접두사라 클라이언트 번들에 인라인되고
// .env 파일이 배포 환경으로 새기 쉬운데, 그 한 번의 사고가 곧바로 완전한 인증 우회가 된다.
// NODE_ENV를 함께 보면 프로덕션 빌드에서는 위 분기 전체가 죽는다(개발 편의는 그대로 유지된다).
export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_DEV_MODE === 'true';
}
