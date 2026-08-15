// 도메인 불변식 위반을 나타내는 예외 클래스. 적절한 계층(호출부의 try/catch)에서 포착해 처리한다.
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidTaxInputError extends DomainError {}

/**
 * 시뮬레이션 입력이 도메인적으로 성립하지 않을 때. 조용히 보정하지 않고 던지는 이유는,
 * 보정한 값도 결국 사용자가 입력하지 않은 계획이기 때문이다 — 특히 부호가 뒤집힌 금액은
 * 보정해도(0으로 두어도) 여전히 실제보다 낙관적인 결과를 만든다.
 */
export class InvalidSimulationInputError extends DomainError {}
