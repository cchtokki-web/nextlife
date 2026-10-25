/**
 * Client-side End-to-End Encryption (E2EE) utilities using Web Crypto API.
 * Encrypts and decrypts client simulation parameters so that the server only sees ciphertext.
 * Derives a strong 256-bit AES-GCM key from a user-friendly 6-character code using PBKDF2.
 */

// Helper to convert ArrayBuffer to Hex string
export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert Hex string to ArrayBuffer
export function hexToBuf(hex: string): ArrayBuffer {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

// Generate a random 6-character key using readable characters (excluding ambiguous ones: 0, O, 1, I)
export function generateBackupKey(): string {
  if (typeof window === 'undefined') return '';
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const array = new Uint8Array(6);
  window.crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

// Format the key to be clean uppercase (for 6 characters, formatting is simple)
export function formatBackupKey(rawKey: string): string {
  return rawKey.trim().toUpperCase();
}

// PBKDF2 반복 횟수. 기존에 100,000회로 암호화된 데이터도 계속 복호화할 수 있도록
// 레거시 기본값을 유지하고, 새로 암호화하는 데이터부터는 OWASP 권장 수준(PBKDF2-HMAC-SHA256)으로 상향한다.
const LEGACY_PBKDF2_ITERATIONS = 100000;
const CURRENT_PBKDF2_ITERATIONS = 310000;

// Derive a strong 256-bit AES-GCM key from a 6-character code using PBKDF2
async function deriveKeyFromCode(code: string, userId: string, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const codeBuf = encoder.encode(code.trim().toUpperCase());
  // Use the unique user ID as the salt to prevent precomputation attacks
  const saltBuf = encoder.encode(userId);

  // 1. Import raw code as base key material for PBKDF2
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    codeBuf,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // 2. Derive the AES-GCM key using PBKDF2 with SHA-256
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  isEncrypted: true;
  // 이 페이로드를 암호화할 때 사용한 PBKDF2 반복 횟수. 없으면 레거시 기본값으로 간주한다.
  iterations?: number;
}

// Encrypt an object using AES-GCM 256 derived from the 6-character code
export async function encryptData<T>(data: T, code: string, userId: string): Promise<EncryptedData> {
  if (typeof window === 'undefined') {
    throw new Error('Encryption is only supported on the client-side');
  }

  const key = await deriveKeyFromCode(code, userId, CURRENT_PBKDF2_ITERATIONS);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));

  const encryptedBuf = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    encodedData
  );

  return {
    ciphertext: bufToHex(encryptedBuf),
    iv: bufToHex(iv.buffer),
    isEncrypted: true,
    iterations: CURRENT_PBKDF2_ITERATIONS
  };
}

// Decrypt an AES-GCM 256 encrypted payload using the 6-character code
export async function decryptData<T = unknown>(payload: EncryptedData, code: string, userId: string): Promise<T> {
  if (typeof window === 'undefined') {
    throw new Error('Decryption is only supported on the client-side');
  }

  const key = await deriveKeyFromCode(code, userId, payload.iterations ?? LEGACY_PBKDF2_ITERATIONS);
  const ivBuf = hexToBuf(payload.iv);
  const ciphertextBuf = hexToBuf(payload.ciphertext);
  
  const decryptedBuf = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(ivBuf)
    },
    key,
    ciphertextBuf
  );
  
  const decoder = new TextDecoder();
  const decodedStr = decoder.decode(decryptedBuf);
  
  return JSON.parse(decodedStr);
}

// Check if a payload is encrypted
export function isEncryptedPayload(data: unknown): data is EncryptedData {
  return !!data && typeof data === 'object' && (data as EncryptedData).isEncrypted === true
    && typeof (data as EncryptedData).ciphertext === 'string' && typeof (data as EncryptedData).iv === 'string';
}
