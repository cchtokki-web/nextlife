import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
    rules: {
      // '_' 접두어는 "의도적으로 쓰지 않는 값"이라는 이 저장소의 관례다. 시그니처를 맞추려고
      // 받아 두는 콜백 인자(_params), 구조분해로 걷어내는 필드(_unused) 등이 여기 해당한다.
      // 관례를 규칙에 등록하지 않으면 의도적인 표기가 계속 경고로 남아 진짜 미사용 코드를 덮는다.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
