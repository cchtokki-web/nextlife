import { describe, test, expect } from 'vitest';
import {
  bufToHex,
  hexToBuf,
  generateBackupKey,
  formatBackupKey,
  encryptData,
  decryptData,
  isEncryptedPayload,
  type EncryptedData,
} from '@/core/utils/crypto';

// crypto.ts 내부의 LEGACY_PBKDF2_ITERATIONS(100000)는 export되지 않으므로
// 하위호환 계약(과거 100,000회로 암호화된 데이터도 복호화 가능해야 함)을 검증하기 위해 동일한 값을 여기서도 사용한다.
const LEGACY_PBKDF2_ITERATIONS = 100000;

describe('crypto.ts (E2EE 유틸리티)', () => {
  const CODE = 'AB23CD';
  const USER_ID = 'user-abc-123';

  describe('encryptData / decryptData 라운드트립', () => {
    test('중첩된 객체를 암호화 후 같은 code/userId로 복호화하면 원본과 deep equal', async () => {
      const original = {
        userProfile: {
          currentAge: 40,
          retirementAge: 60,
          expectancy: 85,
          targetMonthlySpending: 3000000,
        },
        assets: [
          { id: 'asset-1', type: 'etf', ticker: 'VOO', quantity: 100, tags: ['growth', 'us'] },
        ],
        nested: {
          deep: {
            value: null,
            flag: false,
            list: [1, 2, 3],
          },
        },
      };

      const encrypted = await encryptData(original, CODE, USER_ID);
      expect(encrypted.isEncrypted).toBe(true);
      expect(typeof encrypted.ciphertext).toBe('string');
      expect(typeof encrypted.iv).toBe('string');

      const decrypted = await decryptData(encrypted, CODE, USER_ID);
      expect(decrypted).toEqual(original);
    });

    test('암호화된 payload는 현재 PBKDF2 반복 횟수(310000)를 iterations 필드에 기록한다', async () => {
      const encrypted = await encryptData({ a: 1 }, CODE, USER_ID);
      expect(encrypted.iterations).toBe(310000);
    });

    test('잘못된 code로 복호화하면 실패한다', async () => {
      const encrypted = await encryptData({ secret: 'value' }, CODE, USER_ID);
      await expect(decryptData(encrypted, 'WRONGCODE', USER_ID)).rejects.toThrow();
    });

    test('다른 userId(salt가 다름)로 복호화하면 실패한다', async () => {
      const encrypted = await encryptData({ secret: 'value' }, CODE, USER_ID);
      await expect(decryptData(encrypted, CODE, 'different-user-id')).rejects.toThrow();
    });

    test('LEGACY_PBKDF2_ITERATIONS(100000)로 암호화된 것으로 간주되는 payload도 복호화 가능하다', async () => {
      // decryptData는 payload.iterations가 있으면 그 값을, 없으면 LEGACY_PBKDF2_ITERATIONS(100000)를
      // 사용해 키를 유도한다. 따라서 과거(iterations 필드가 없던 시절) 방식과 동일하게
      // iterations를 명시적으로 100000으로 지정한 payload를 만들어 하위호환을 검증한다.

      // 1) 레거시 방식(반복 횟수를 명시하지 않은 옛 payload)을 재현하기 위해
      //    CURRENT 반복 횟수로 암호화한 뒤 iterations 필드를 제거해 "필드가 없는" 케이스도 함께 확인한다.
      const original = { legacy: true, data: [1, 2, 3] };

      // encryptData는 항상 CURRENT_PBKDF2_ITERATIONS로 암호화하므로,
      // 레거시(100000회) 암호화를 재현하려면 동일한 키 유도 로직을 직접 수행해야 한다.
      // crypto.ts가 export하는 함수만으로는 반복 횟수를 주입할 수 없으므로,
      // decryptData의 "payload.iterations 값을 그대로 사용" 계약을 검증하기 위해
      // Web Crypto API를 직접 사용해 100000회로 암호화한 payload를 구성한다.
      const encoder = new TextEncoder();
      const codeBuf = encoder.encode(CODE.trim().toUpperCase());
      const saltBuf = encoder.encode(USER_ID);

      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        codeBuf,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );
      const legacyKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBuf,
          iterations: LEGACY_PBKDF2_ITERATIONS,
          hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encodedData = encoder.encode(JSON.stringify(original));
      const encryptedBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        encodedData
      );

      const legacyPayload: EncryptedData = {
        ciphertext: bufToHex(encryptedBuf),
        iv: bufToHex(iv.buffer),
        isEncrypted: true,
        iterations: LEGACY_PBKDF2_ITERATIONS,
      };

      const decrypted = await decryptData(legacyPayload, CODE, USER_ID);
      expect(decrypted).toEqual(original);

      // 2) iterations 필드 자체가 없는 (더 예전) payload도 LEGACY_PBKDF2_ITERATIONS로 간주되어
      //    복호화되어야 한다 (decryptData의 `payload.iterations ?? LEGACY_PBKDF2_ITERATIONS` 계약).
      const legacyPayloadWithoutIterations: EncryptedData = {
        ciphertext: legacyPayload.ciphertext,
        iv: legacyPayload.iv,
        isEncrypted: true,
      };
      const decryptedWithoutField = await decryptData(
        legacyPayloadWithoutIterations,
        CODE,
        USER_ID
      );
      expect(decryptedWithoutField).toEqual(original);
    });
  });

  describe('isEncryptedPayload', () => {
    test('정상적인 EncryptedData 형태는 true를 반환한다', () => {
      const valid: EncryptedData = {
        ciphertext: 'deadbeef',
        iv: 'cafebabe',
        isEncrypted: true,
        iterations: 310000,
      };
      expect(isEncryptedPayload(valid)).toBe(true);
    });

    test('iterations 필드가 없어도 나머지 필드가 유효하면 true를 반환한다', () => {
      const valid = {
        ciphertext: 'deadbeef',
        iv: 'cafebabe',
        isEncrypted: true,
      };
      expect(isEncryptedPayload(valid)).toBe(true);
    });

    test('null은 falsy 값을 반환한다', () => {
      // 구현이 `data && typeof data === 'object' && ...`로 단락 평가되어 있어
      // null/undefined 입력 시 boolean false가 아니라 입력값(null/undefined)을
      // 그대로 반환한다. 타입가드의 실제 반환값을 그대로 검증한다.
      expect(isEncryptedPayload(null)).toBeFalsy();
    });

    test('undefined는 falsy 값을 반환한다', () => {
      expect(isEncryptedPayload(undefined)).toBeFalsy();
    });

    test('평범한 SimulationParams 형태 객체는 false를 반환한다', () => {
      const plain = {
        userProfile: { currentAge: 40, retirementAge: 60 },
      };
      expect(isEncryptedPayload(plain)).toBe(false);
    });

    test('필드 일부가 누락되면 false를 반환한다', () => {
      expect(isEncryptedPayload({ ciphertext: 'deadbeef', isEncrypted: true })).toBe(false); // iv 누락
      expect(isEncryptedPayload({ iv: 'cafebabe', isEncrypted: true })).toBe(false); // ciphertext 누락
      expect(isEncryptedPayload({ ciphertext: 'deadbeef', iv: 'cafebabe' })).toBe(false); // isEncrypted 누락
    });

    test('필드 타입이 다르면 false를 반환한다', () => {
      expect(
        isEncryptedPayload({ ciphertext: 12345, iv: 'cafebabe', isEncrypted: true })
      ).toBe(false);
      expect(
        isEncryptedPayload({ ciphertext: 'deadbeef', iv: 'cafebabe', isEncrypted: 'true' })
      ).toBe(false);
    });

    test('isEncrypted가 false이면 false를 반환한다', () => {
      expect(
        isEncryptedPayload({ ciphertext: 'deadbeef', iv: 'cafebabe', isEncrypted: false })
      ).toBe(false);
    });
  });

  describe('generateBackupKey', () => {
    // vitest.config.ts의 test.environment가 'jsdom'이므로 window가 존재하는 환경에서 실행된다.
    test('6자리 길이의 문자열을 반환한다', () => {
      const key = generateBackupKey();
      expect(key).toHaveLength(6);
    });

    test('허용 문자셋(숫자 2-9, A-Z 중 O/I 제외)만 포함한다', () => {
      // 여러 번 생성해 통계적으로 허용 문자셋을 벗어나지 않는지 확인한다.
      const allowedCharsPattern = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
      for (let i = 0; i < 200; i++) {
        const key = generateBackupKey();
        expect(key).toMatch(allowedCharsPattern);
      }
    });

    test('생성된 키에는 혼동되기 쉬운 문자(0, O, 1, I)가 포함되지 않는다', () => {
      const ambiguousChars = /[01OI]/;
      for (let i = 0; i < 200; i++) {
        const key = generateBackupKey();
        expect(key).not.toMatch(ambiguousChars);
      }
    });
  });

  describe('formatBackupKey', () => {
    test('앞뒤 공백을 제거하고 대문자로 변환한다', () => {
      expect(formatBackupKey('  ab23cd  ')).toBe('AB23CD');
    });

    test('이미 대문자이고 공백이 없으면 그대로 반환한다', () => {
      expect(formatBackupKey('AB23CD')).toBe('AB23CD');
    });
  });

  describe('bufToHex / hexToBuf 왕복 변환', () => {
    test('임의의 바이트 배열을 hex로 변환 후 다시 buffer로 변환하면 원본과 일치한다', () => {
      const original = new Uint8Array([0, 1, 2, 16, 255, 128, 64, 32]);
      const hex = bufToHex(original.buffer);
      const roundTripped = new Uint8Array(hexToBuf(hex));
      expect(Array.from(roundTripped)).toEqual(Array.from(original));
    });

    test('빈 버퍼도 왕복 변환된다', () => {
      const original = new Uint8Array([]);
      const hex = bufToHex(original.buffer);
      expect(hex).toBe('');
      const roundTripped = new Uint8Array(hexToBuf(hex));
      expect(roundTripped.length).toBe(0);
    });

    test('bufToHex는 각 바이트를 2자리 소문자 hex로 패딩한다', () => {
      const original = new Uint8Array([0, 5, 255]);
      expect(bufToHex(original.buffer)).toBe('0005ff');
    });

    test('hexToBuf는 홀수 길이의 hex 문자열에 대해 에러를 던진다', () => {
      expect(() => hexToBuf('abc')).toThrow('Invalid hex string length');
    });
  });
});
