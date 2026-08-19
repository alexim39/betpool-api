import { UserModel } from '../models/user.model';

const MAX_ATTEMPTS = 6;

const SUFFIX_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export const USERNAME_REGEX = /^[a-z0-9._-]{3,24}$/;

const RESERVED_USERNAMES = new Set(['ora', 'admin', 'support', 'betpool', 'investbetz']);

export function normalizeUsername(value: string): string {
  return (value || '').trim().toLowerCase();
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!USERNAME_REGEX.test(username)) {
    return 'Username must be 3-24 characters (letters, numbers, dots, dashes, underscores)';
  }
  if (RESERVED_USERNAMES.has(username)) {
    return 'That username is reserved';
  }
  return null;
}

function slugifyName(fullName: string): string {
  return (fullName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14);
}

function randomSuffix(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SUFFIX_CHARS.charAt(Math.floor(Math.random() * SUFFIX_CHARS.length));
  }
  return out;
}

export function generateUsername(fullName: string): string {
  const base = slugifyName(fullName) || 'user';
  return `${base}_${randomSuffix(5)}`;
}

export async function reserveUsername(
  fullName: string,
  taken: Set<string> = new Set(),
  isOra = false
): Promise<string> {
  if (isOra) {
    const oraTaken = await UserModel.findOne({ username: 'ora' }).select('_id').lean();
    if (!oraTaken && !taken.has('ora')) return 'ora';
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateUsername(fullName);
    if (taken.has(candidate) || RESERVED_USERNAMES.has(candidate)) continue;
    const clash = await UserModel.findOne({ username: candidate }).select('_id').lean();
    if (!clash) return candidate;
  }
  const base = slugifyName(fullName) || 'user';
  return `${base}_${randomSuffix(9)}`;
}