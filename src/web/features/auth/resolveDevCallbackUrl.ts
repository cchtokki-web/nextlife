// 개발 모드 자동 로그인 뒤 이동할 경로를 고른다.
//
// 같은 출처의 경로만 허용한다. `startsWith('/')`만 보면 프로토콜 상대 URL(`//evil.com`)이
// 통과하고, `window.location.href = '//evil.com'`은 실제로 외부 사이트로 나간다.
// 백슬래시 변형(`/\evil.com`)도 일부 브라우저가 프로토콜 상대로 해석하므로 함께 막는다.
//
// 통과하지 못하면 조용히 루트로 보낸다 — 자동 로그인 경로라 사용자에게 물을 자리가 없고,
// 루트는 언제나 안전한 목적지다.
export function resolveDevCallbackUrl(search: string): string {
  const callbackUrl = new URLSearchParams(search).get('callbackUrl');
  if (!callbackUrl) return '/';

  // 첫 글자가 '/'이고, 두 번째 글자가 '/'나 '\'가 아니어야 같은 출처의 경로다.
  if (!/^\/(?![/\\])/.test(callbackUrl)) return '/';

  return callbackUrl;
}
