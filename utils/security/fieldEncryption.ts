/**
 * Field-Level Encryption for Mongoose
 *
 * Provides automatic encryption/decryption of sensitive fields in MongoDB documents.
 * Uses AES-256-GCM encryption for data at rest.
 *
 * Features:
 * - Automatic encryption on save
 * - Automatic decryption on find
 * - Supports both string and object fields
 * - Graceful handling of unencrypted legacy data
 *
 * @module utils/fieldEncryption
 */

import { encrypt, decrypt } from './encryption.js';
import logger from '../../config/logger.js';

/**
 * Check if a string looks like encrypted data
 * Supports both legacy (iv:authTag:encrypted) and versioned (v1:iv:authTag:encrypted) formats
 *
 * @param {string} value - Value to check
 * @returns {boolean} True if appears to be encrypted
 */
export function isEncrypted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');

  // Check for versioned format: v{n}:iv:authTag:encrypted (4 parts)
  if (parts.length === 4 && /^v\d+$/.test(parts[0])) {
    return (
      parts[1].length === 32 &&
      parts[2].length === 32 &&
      /^[a-f0-9]+$/i.test(parts[1]) &&
      /^[a-f0-9]+$/i.test(parts[2])
    );
  }

  // Check for legacy format: iv:authTag:encrypted (3 parts)
  return (
    parts.length === 3 &&
    parts[0].length === 32 &&
    parts[1].length === 32 &&
    /^[a-f0-9]+$/i.test(parts[0]) &&
    /^[a-f0-9]+$/i.test(parts[1])
  );
}

/**
 * Safely encrypt a value, handling edge cases
 *
 * @param {string} value - Value to encrypt
 * @returns {string|null} Encrypted value or null
 */
export function safeEncrypt(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  if (isEncrypted(value)) return value; // Already encrypted

  try {
    return encrypt(value);
  } catch (error) {
    logger.error('Field encryption failed', {
      service: 'encryption',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Safely decrypt a value, handling legacy unencrypted data
 *
 * @param {string} value - Value to decrypt
 * @returns {string} Decrypted value or original if not encrypted
 */
export function safeDecrypt(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  if (!isEncrypted(value)) return value; // Not encrypted (legacy data)

  try {
    return decrypt(value);
  } catch (error) {
    logger.warn('Field decryption failed, returning original value', {
      service: 'encryption',
      error: error instanceof Error ? error.message : String(error),
    });
    // Return original value if decryption fails (could be legacy data)
    return value;
  }
}

/**
 * Encrypt an object's specified fields
 *
 * @param {Object} obj - Object containing fields to encrypt
 * @param {string[]} fields - Array of field paths to encrypt
 * @returns {Object} Object with encrypted fields
 */
export function encryptFields(obj: Record<string, unknown> | null | undefined, fields: string[]) {
  if (!obj) return obj;

  const result = { ...obj };

  for (const field of fields) {
    const value = getNestedValue(result, field);
    if (value !== undefined && value !== null) {
      setNestedValue(result, field, safeEncrypt(String(value)));
    }
  }

  return result;
}

/**
 * Decrypt an object's specified fields
 *
 * @param {Object} obj - Object containing encrypted fields
 * @param {string[]} fields - Array of field paths to decrypt
 * @returns {Object} Object with decrypted fields
 */
export function decryptFields(obj: Record<string, unknown> | null | undefined, fields: string[]) {
  if (!obj) return obj;

  const result = { ...obj };

  for (const field of fields) {
    const value = getNestedValue(result, field);
    if (value !== undefined && value !== null) {
      setNestedValue(result, field, safeDecrypt(value));
    }
  }

  return result;
}

/**
 * Get nested value from object using dot notation
 *
 * @param {Object} obj - Object to get value from
 * @param {string} path - Dot-notation path (e.g., 'user.email')
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Set nested value in object using dot notation
 *
 * @param {Object} obj - Object to set value in
 * @param {string} path - Dot-notation path
 * @param {*} value - Value to set
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const lastKey = keys.pop() as string;
  const target = keys.reduce<Record<string, unknown>>((current, key) => {
    if (current[key] === undefined) current[key] = {};
    return current[key] as Record<string, unknown>;
  }, obj);
  target[lastKey] = value;
}

export default {
  isEncrypted,
  safeEncrypt,
  safeDecrypt,
  encryptFields,
  decryptFields,
};
