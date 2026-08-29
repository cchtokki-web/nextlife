import { describe, expect, it } from 'vitest';
import {
  SCENARIO_ANALYSIS_HASH_VERSION,
  isComparableScenarioAnalysisHash,
  scenarioAnalysisHash,
} from '@/core/utils/scenarioAnalysisHash';
import { initialParams } from '@/infrastructure/storage/defaultParams';
import type { SimulationParams } from '@/core/entities/types';

// 실제 시나리오와 같은 모양(중첩 객체·배열·optional 필드)을 쓴다. 2필드 스텁을 캐스팅하면
// tsc가 막을 뿐 아니라, 이 함수가 실제로 다루는 왕복·undefined·배열 경로를 한 번도
// 지나지 않아 아래 회귀들이 전부 무력해진다.
const params: SimulationParams = initialParams;

describe('scenarioAnalysisHash', () => {
  it('returns the same hash for equivalent objects with different key order', () => {
    expect(scenarioAnalysisHash({ ...params, userProfile: { ...params.userProfile } })).toBe(
      scenarioAnalysisHash(params),
    );
  });

  it('changes when an analysis input changes', () => {
    expect(scenarioAnalysisHash(params)).not.toBe(
      scenarioAnalysisHash({
        ...params,
        userProfile: { ...params.userProfile, currentAge: params.userProfile.currentAge + 1 },
      }),
    );
  });

  // 해시는 메모리의 params로 계산되고(setScenarioAnalyzed), 다음 접속에서는 «암호화 → 저장 →
  // 복호화 → JSON.parse»를 지난 params로 다시 계산된다. JSON 왕복은 값이 undefined인 키를
  // 통째로 지우므로, 그 차이를 흡수하지 않으면 방금 분석한 시나리오가 새로고침 한 번에
  // 영구히 「재분석 필요」로 남는다.
  it('survives a JSON round-trip', () => {
    const roundTripped = JSON.parse(JSON.stringify(params)) as SimulationParams;
    expect(scenarioAnalysisHash(roundTripped)).toBe(scenarioAnalysisHash(params));
  });

  it('treats an explicitly undefined key as an absent key', () => {
    expect(scenarioAnalysisHash({ ...params, isaAccounts: undefined })).toBe(
      scenarioAnalysisHash(params),
    );
  });

  it('distinguishes array order', () => {
    const twoAssets: SimulationParams = {
      ...params,
      assets: [
        { ...params.assets[0], id: 'a' },
        { ...params.assets[0], id: 'b' },
      ],
    };
    const reversed: SimulationParams = { ...twoAssets, assets: [...twoAssets.assets].reverse() };
    expect(scenarioAnalysisHash(twoAssets)).not.toBe(scenarioAnalysisHash(reversed));
  });

  // NaN·Infinity·null은 JSON.stringify가 모두 "null"로 뭉갠다. 뭉개지면 서로 다른 입력이 같은
  // 해시를 받아 «바뀐» 시나리오가 「분석 완료」로 남는다 — 조용히 틀린 금융 화면이다.
  it('does not collapse non-finite numbers onto null', () => {
    const withNaN = { ...params, inflationRate: Number.NaN } as SimulationParams;
    const withNull = { ...params, inflationRate: null } as unknown as SimulationParams;
    const withInfinity = { ...params, inflationRate: Number.POSITIVE_INFINITY } as SimulationParams;

    expect(scenarioAnalysisHash(withNaN)).not.toBe(scenarioAnalysisHash(withNull));
    expect(scenarioAnalysisHash(withNaN)).not.toBe(scenarioAnalysisHash(withInfinity));
  });

  describe('표시용 필드는 해시에 넣지 않는다', () => {
    // 넣으면 계산 입력이 하나도 바뀌지 않았는데 「재분석 필요」가 뜬다. 배지가 늑대를 외치기
    // 시작하면 사용자는 진짜 경고까지 무시한다.
    it('ignores strategy.mode (공개 수준일 뿐 계산에 쓰이지 않는다)', () => {
      const simple: SimulationParams = {
        ...params,
        strategy: { ...params.strategy!, mode: 'simple' },
      };
      const expert: SimulationParams = {
        ...params,
        strategy: { ...params.strategy!, mode: 'expert' },
      };
      expect(scenarioAnalysisHash(simple)).toBe(scenarioAnalysisHash(expert));
    });

    it('ignores yieldPreset and customYieldSnapshot', () => {
      expect(scenarioAnalysisHash({ ...params, yieldPreset: 'aggressive' })).toBe(
        scenarioAnalysisHash({ ...params, yieldPreset: 'conservative' }),
      );
    });

    it('still reacts to a strategy field the engine reads', () => {
      expect(
        scenarioAnalysisHash({
          ...params,
          strategy: { ...params.strategy!, nationalPensionStrategy: 'defer_max' },
        }),
      ).not.toBe(
        scenarioAnalysisHash({
          ...params,
          strategy: { ...params.strategy!, nationalPensionStrategy: 'normal' },
        }),
      );
    });
  });

  describe('버전 태그', () => {
    it('prefixes the hash with the serialization version', () => {
      expect(scenarioAnalysisHash(params)).toMatch(
        new RegExp(`^${SCENARIO_ANALYSIS_HASH_VERSION}:[0-9a-f]{16}$`),
      );
    });

    // 직렬화 규칙이나 해시 상수를 바꾸면 저장된 모든 해시의 «의미»가 달라진다. 버전을 올리지
    // 않으면 배포 순간 전 사용자의 모든 시나리오가 한꺼번에 「재분석 필요」로 뒤집히는데,
    // CI는 아무것도 실패하지 않는다. 이 값이 깨지면 버전을 올리라는 신호다.
    it('is stable for a frozen fixture', () => {
      const frozen = {
        userProfile: { currentAge: 45, lifeExpectancy: 90 },
        assets: [{ id: 'a', amount: 1000 }],
        inflationRate: 2.5,
      } as unknown as SimulationParams;
      expect(scenarioAnalysisHash(frozen)).toBe('v1:94d784f8cec7fbea');
    });

    it('rejects hashes written by an unknown version', () => {
      expect(isComparableScenarioAnalysisHash(scenarioAnalysisHash(params))).toBe(true);
      // 이 필드가 생기기 전 형식(버전 없는 8자리)과 미래 버전은 둘 다 비교 대상이 아니다.
      expect(isComparableScenarioAnalysisHash('1a2b3c4d')).toBe(false);
      expect(isComparableScenarioAnalysisHash('v2:0123456789abcdef')).toBe(false);
      expect(isComparableScenarioAnalysisHash(null)).toBe(false);
      expect(isComparableScenarioAnalysisHash(undefined)).toBe(false);
    });
  });
});
