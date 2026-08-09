-- 이메일 전용 계정 체계로 전환할 때 계정과 계정에 종속된 데이터만 초기화한다.
-- Scenario(그리고 구버전 스키마의 Account/Session)는 User의 ON DELETE CASCADE로 삭제된다.
-- 계정과 무관한 AnalyticsEvent는 의도적으로 보존한다.
PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;
DELETE FROM "VerificationToken";
DELETE FROM "User";
COMMIT;
