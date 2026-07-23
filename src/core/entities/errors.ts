// 도메인 불변식 위반을 나타내는 예외 클래스. 적절한 계층(호출부의 try/catch)에서 포착해 처리한다.
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidTaxInputError extends DomainError {}
