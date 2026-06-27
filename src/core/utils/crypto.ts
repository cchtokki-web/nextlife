/**
 * Client-side End-to-End Encryption (E2EE) utilities using Web Crypto API.
 * Encrypts and decrypts client simulation parameters so that the server only sees ciphertext.
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

// Generate a random 256-bit key in Hex format
export function generateBackupKey(): string {
  if (typeof window === 'undefined') return '';
  const array = new Uint8Array(32); // 256 bits
  window.crypto.getRandomValues(array);
  return bufToHex(array.buffer);
}

// Format the key to be user-friendly (e.g. XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX)
export function formatBackupKey(rawKey: string): string {
  const clean = rawKey.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (clean.length !== 64) return rawKey;
  const parts = [];
  for (let i = 0; i < clean.length; i += 8) {
    parts.push(clean.substring(i, i + 8));
  }
  return parts.join('-');
}

// Import a hex key string to a CryptoKey object
async function importKey(rawHex: string): Promise<CryptoKey> {
  const keyBuf = hexToBuf(rawHex);
  return window.crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  isEncrypted: true;
}

// Encrypt an object using AES-GCM 256
export async function encryptData(data: any, rawKeyHex: string): Promise<EncryptedData> {
  if (typeof window === 'undefined') {
    throw new Error('Encryption is only supported on the client-side');
  }
  
  const key = await importKey(rawKeyHex);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV is standard for AES-GCM
  
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
    isEncrypted: true
  };
}

// Decrypt an AES-GCM 256 encrypted payload
export async function decryptData(payload: EncryptedData, rawKeyHex: string): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('Decryption is only supported on the client-side');
  }
  
  const key = await importKey(rawKeyHex);
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
export function isEncryptedPayload(data: any): data is EncryptedData {
  return data && typeof data === 'object' && data.isEncrypted === true && typeof data.ciphertext === 'string' && typeof data.iv === 'string';
}
