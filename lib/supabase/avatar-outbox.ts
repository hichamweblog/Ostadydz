import { del, get, keys, set } from 'idb-keyval';

const PREFIX = 'sanad:avatar-outbox:';
export interface AvatarOutboxEntry {
  id: 'profile';
  action: 'upload' | 'delete';
  file?: Blob;
  createdAt: string;
}

export async function enqueueAvatarUpload(file: File): Promise<void> {
  await set(`${PREFIX}profile`, {
    id: 'profile',
    action: 'upload',
    file,
    createdAt: new Date().toISOString(),
  } satisfies AvatarOutboxEntry);
}

export async function enqueueAvatarDelete(): Promise<void> {
  await set(`${PREFIX}profile`, {
    id: 'profile',
    action: 'delete',
    createdAt: new Date().toISOString(),
  } satisfies AvatarOutboxEntry);
}

export async function getAvatarOutboxEntry(): Promise<AvatarOutboxEntry | undefined> {
  const entry = await get<AvatarOutboxEntry>(`${PREFIX}profile`);
  return entry && (entry.action === 'delete' || entry.file) ? entry : undefined;
}

export async function removeAvatarOutboxEntry(): Promise<void> {
  await del(`${PREFIX}profile`);
}

export async function clearAvatarOutbox(): Promise<void> {
  await Promise.all((await keys())
    .filter((key): key is string => typeof key === 'string' && key.startsWith(PREFIX))
    .map((key) => del(key)));
}
