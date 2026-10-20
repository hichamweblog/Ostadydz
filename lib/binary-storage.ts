import { get, set, del, keys } from 'idb-keyval';

export async function saveBinaryFile(key: string, data: string): Promise<void> {
  try {
    await set(key, data);
  } catch (error) {
    console.error('Error saving binary file to IndexedDB:', error);
    throw error;
  }
}

export async function loadBinaryFile(key: string): Promise<string | undefined> {
  try {
    return await get<string>(key);
  } catch (error) {
    console.error('Error loading binary file from IndexedDB:', error);
    return undefined;
  }
}

export async function deleteBinaryFile(key: string): Promise<void> {
  try {
    await del(key);
  } catch (error) {
    console.error('Error deleting binary file from IndexedDB:', error);
    throw error;
  }
}

export async function listBinaryKeys(): Promise<string[]> {
  try {
    const allKeys = await keys();
    return allKeys.filter((k): k is string => typeof k === 'string');
  } catch (error) {
    console.error('Error listing binary keys from IndexedDB:', error);
    return [];
  }
}

const PDF_PREFIX = 'sanad:pdf:';
const AVATAR_KEY = 'sanad:avatar:profile';

/**
 * Curriculum unit ids are shared by every teacher, so the stored binary key must be
 * scoped to the owner. `sanad:pdf:<unitId>` (no owner) is the legacy format.
 */
export function binaryKeyForPdf(unitId: string, ownerId?: string | null): string {
  return `${PDF_PREFIX}${ownerId || 'anon'}:${unitId}`;
}

export function legacyBinaryKeyForPdf(unitId: string): string {
  return `${PDF_PREFIX}${unitId}`;
}

/**
 * Reads a teacher's local PDF for a unit, migrating a legacy unscoped entry to the
 * owner-scoped key the first time it is used (so a shared device stops serving it).
 */
export async function loadPdfBinary(unitId: string, ownerId?: string | null): Promise<string | undefined> {
  const scoped = await loadBinaryFile(binaryKeyForPdf(unitId, ownerId));
  if (scoped) return scoped;
  const legacyKey = legacyBinaryKeyForPdf(unitId);
  const legacy = await loadBinaryFile(legacyKey);
  if (!legacy) return undefined;
  await saveBinaryFile(binaryKeyForPdf(unitId, ownerId), legacy);
  await deleteBinaryFile(legacyKey);
  return legacy;
}

export async function savePdfBinary(unitId: string, dataUrl: string, ownerId?: string | null): Promise<string> {
  const key = binaryKeyForPdf(unitId, ownerId);
  await saveBinaryFile(key, dataUrl);
  // Never keep the unscoped copy: it would leak into whichever account opens next.
  await deleteBinaryFile(legacyBinaryKeyForPdf(unitId));
  return key;
}

/** Unit ids whose PDF is stored on this device for this owner (offline availability). */
export async function listStoredPdfUnitIds(ownerId?: string | null): Promise<string[]> {
  const prefix = `${PDF_PREFIX}${ownerId || 'anon'}:`;
  try {
    const all = await keys();
    return all
      .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((unitId) => unitId.length > 0);
  } catch (error) {
    console.error('Error listing stored PDFs from IndexedDB:', error);
    return [];
  }
}

export function binaryKeyForAvatar(): string {
  return AVATAR_KEY;
}

export async function clearTeacherBinaryFiles(ownerId?: string | null): Promise<void> {
  const keysToDelete = (await listBinaryKeys()).filter((key) => {
    if (key === AVATAR_KEY) return true;
    if (!key.startsWith(PDF_PREFIX)) return false;
    if (!ownerId) return true;
    if (key.startsWith(`${PDF_PREFIX}${ownerId}:`)) return true;
    // Legacy unscoped keys have no owner segment and can belong to anyone, so they are
    // always cleared instead of being left for the next account on this device.
    return !key.slice(PDF_PREFIX.length).includes(':');
  });
  await Promise.all(keysToDelete.map((key) => deleteBinaryFile(key)));
}
