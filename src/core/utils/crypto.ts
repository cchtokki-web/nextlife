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

// Derive a strong 256-bit AES-GCM key from a 6-character code using PBKDF2
async function deriveKeyFromCode(code: string, userId: string): Promise<CryptoKey> {
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
      iterations: 100000,
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
}

// Encrypt an object using AES-GCM 256 derived from the 6-character code
export async function encryptData(data: any, code: string, userId: string): Promise<EncryptedData> {
  if (typeof window === 'undefined') {
    throw new Error('Encryption is only supported on the client-side');
  }
  
  const key = await deriveKeyFromCode(code, userId);
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
    isEncrypted: true
  };
}

// Decrypt an AES-GCM 256 encrypted payload using the 6-character code
export async function decryptData(payload: EncryptedData, code: string, userId: string): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('Decryption is only supported on the client-side');
  }
  
  const key = await deriveKeyFromCode(code, userId);
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
