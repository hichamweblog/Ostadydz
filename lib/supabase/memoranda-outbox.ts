import { del, get, keys, set } from 'idb-keyval';

export type MemorandaOutboxOperation =
  | {
      id: string;
      ownerId: string;
      action: 'upload';
      unitId: string;
      fileName: string;
      file: Blob;
      createdAt: string;
    }
  | {
      id: string;
      ownerId: string;
      action: 'delete';
      storagePath: string;
      createdAt: string;
    };

const PREFIX = 'sanad:memoranda-outbox:';
const LEGACY_PREFIX = 'sanad:memoranda-outbox:upload:';
const LEGACY_PREFIX_DELETE = 'sanad:memoranda-outbox:delete:';

const outboxKey = (ownerId: string, id: string) => `${PREFIX}${ownerId}:${id}`;

/** Legacy entries had no owner id; they are adopted by the authenticated owner once. */
function isLegacyKey(key: string): boolean {
  return key.startsWith(LEGACY_PREFIX) || key.startsWith(LEGACY_PREFIX_DELETE);
}

export async function enqueueMemorandaUpload(ownerId: string, unitId: string, file: File): Promise<void> {
  const id = `upload:${unitId}`;
  await set(outboxKey(ownerId, id), {
    id,
    ownerId,
    action: 'upload',
    unitId,
    fileName: file.name,
    file,
    createdAt: new Date().toISOString(),
  } satisfies MemorandaOutboxOperation);
}

export async function enqueueMemorandaDelete(ownerId: string, storagePath: string): Promise<void> {
  const id = `delete:${storagePath}`;
  await set(outboxKey(ownerId, id), {
    id,
    ownerId,
    action: 'delete',
    storagePath,
    createdAt: new Date().toISOString(),
  } satisfies MemorandaOutboxOperation);
}

export async function cancelMemorandaUpload(ownerId: string, unitId: string): Promise<void> {
  await del(outboxKey(ownerId, `upload:${unitId}`));
}

/**
 * Lists pending memoranda operations for one owner only. Operations queued before owner
 * ids existed are adopted by the given owner (they are then rewritten under the new key),
 * so an upload can never be flushed into a different account than the one that queued it.
 */
export async function listMemorandaOutbox(ownerId: string): Promise<MemorandaOutboxOperation[]> {
  const allKeys = (await keys()).filter((key): key is string => typeof key === 'string');
  const ownedKeys = allKeys.filter((key) => key.startsWith(PREFIX) && key.startsWith(`${PREFIX}${ownerId}:`));
  const legacyKeys = allKeys.filter((key) => isLegacyKey(key) && !key.includes(ownerId));

  const entries = await Promise.all([
    ...ownedKeys.map((key) => get<MemorandaOutboxOperation>(key)),
    ...legacyKeys.map(async (key) => {
      const legacy = await get<Omit<MemorandaOutboxOperation, 'ownerId'>>(key);
      if (!legacy?.id || !legacy.action) {
        await del(key);
        return undefined;
      }
      const adopted = { ...legacy, ownerId } as MemorandaOutboxOperation;
      await set(outboxKey(ownerId, adopted.id), adopted);
      await del(key);
      return adopted;
    }),
  ]);

  return entries
    .filter((entry): entry is MemorandaOutboxOperation => Boolean(entry?.id && entry.action && entry.ownerId === ownerId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeMemorandaOutboxEntry(ownerId: string, id: string): Promise<void> {
  await del(outboxKey(ownerId, id));
}

export async function clearMemorandaOutbox(ownerId: string): Promise<void> {
  await Promise.all((await listMemorandaOutbox(ownerId)).map((entry) => removeMemorandaOutboxEntry(ownerId, entry.id)));
}
