import { createSupabaseBrowserClient } from './browser';
import { getAvatarOutboxEntry, removeAvatarOutboxEntry } from './avatar-outbox';

const BUCKET = 'avatars';

async function uploadAvatar(file: Blob, userId: string): Promise<string> {
  const path = `users/${userId}/profile`;
  const client = createSupabaseBrowserClient();
  if (!client) throw new Error('Supabase is unavailable');
  const { data, error: sessionError } = await client.auth.getUser();
  if (sessionError || data.user?.id !== userId) {
    throw new Error('لا توجد جلسة مستخدم صالحة لمزامنة الصورة الشخصية.');
  }
  const result = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (result.error) throw result.error;
  return path;
}

export async function flushAvatarOutbox(userId: string): Promise<void> {
  const entry = await getAvatarOutboxEntry();
  if (!entry) return;
  const client = createSupabaseBrowserClient();
  if (!client) throw new Error('Supabase is unavailable');
  const { data, error: sessionError } = await client.auth.getUser();
  if (sessionError || data.user?.id !== userId) {
    throw new Error('لا توجد جلسة مستخدم صالحة لمزامنة الصورة الشخصية.');
  }
  const path = `users/${userId}/profile`;
  if (entry.action === 'delete') {
    const result = await client.storage.from(BUCKET).remove([path]);
    if (result.error) throw result.error;
  } else if (entry.file) {
    await uploadAvatar(entry.file, userId);
  } else {
    throw new Error('Avatar outbox entry is missing its file');
  }
  await removeAvatarOutboxEntry();
}
