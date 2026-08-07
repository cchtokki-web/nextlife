import { describe, test, expect } from 'vitest';
import { describeFireAge } from '@/core/usecases/dashboard/describeFireAge';

// A2: fireAge의 게이트 기준은 가구 종료 나이(householdEndAge)다. 배우자가 본인보다 오래
// 사는 계획에서는 fireAge가 본인 기대수명을 넘을 수 있고, 단서 없이 숫자만 인쇄하면
// 같은 리포트(그리고 같은 AI 프롬프트)가 "80세 사망"과 "85세 FIRE"를 나란히 말하게 된다.
//
// 여기에 더해 fireAge는 **은퇴 나이와 비교되어야** 의미가 통한다. 60세 은퇴를 계획한
// 사용자에게 "FIRE 조기은퇴 가능 나이 73세"를 그대로 보여주면, 이미 지나간 시점을
// "조기은퇴 가능"이라고 말하는 형용모순이 된다.
describe('describeFireAge', () => {
  test('달성하지 못하면 달성 불가능으로 표기한다', () => {
    expect(describeFireAge(null, 85, 60)).toBe('달성 불가능');
    expect(describeFireAge(undefined, 85, 60)).toBe('달성 불가능');
  });

  test('은퇴 시점까지 달성하면 이미 달성했음을 표기한다', () => {
    expect(describeFireAge(60, 85, 60)).toBe('60세 (은퇴 시점에 이미 달성)');
    expect(describeFireAge(55, 85, 60)).toBe('55세 (은퇴 시점에 이미 달성)');
  });

  // 리포트가 실제로 보여준 조합(은퇴 60세 / FIRE 73세). 숫자만 보여주면 사용자는
  // 무엇이 13년 뒤에 일어난다는 것인지 알 수 없다.
  test('은퇴 나이보다 늦으면 몇 년 늦는지 함께 표기한다', () => {
    const text = describeFireAge(73, 90, 60);

    expect(text).toContain('73세');
    expect(text).toContain('60세');
    expect(text).toContain('13년');
  });

  test('본인 기대수명을 넘으면 배우자 생존 기간 기준임을 함께 표기한다', () => {
    const text = describeFireAge(85, 80, 60);

    expect(text).toContain('85세');
    expect(text).toContain('80세');
    expect(text).toContain('배우자 생존 기간');
  });

  // 기대수명을 넘는 fireAge는 반드시 은퇴 나이보다도 늦다(은퇴 < 기대수명).
  // 두 단서가 모두 필요하다 — 하나만 남기면 다른 하나가 조용히 사라진다.
  test('기대수명을 넘으면 은퇴 대비 지연과 배우자 단서를 모두 표기한다', () => {
    const text = describeFireAge(85, 80, 60);

    expect(text).toContain('25년');
    expect(text).toContain('배우자 생존 기간');
  });
});
