import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from './browser';
import type { Database } from './database.types';
import {
  enqueueMemorandaDelete,
  enqueueMemorandaUpload,
  listMemorandaOutbox,
  removeMemorandaOutboxEntry,
} from './memoranda-outbox';

const BUCKET = 'memoranda';
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (604,800s)

type Client = SupabaseClient<Database>;

async function checksumForBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The authenticated user id even when the workspace/schema is unavailable, so a queued
 * upload can always be attributed to its owner.
 */
async function currentOwnerId(): Promise<string | undefined> {
  const client = createSupabaseBrowserClient();
  if (!client) return undefined;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return undefined;
  return data.user.id;
}

async function currentClient(): Promise<{ client: Client; userId: string; workspaceId: string } | undefined> {
  const client = createSupabaseBrowserClient();
  if (!client) return undefined;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return undefined;
  const workspace = await (client as unknown as {
    rpc: (name: 'default_workspace_id') => Promise<{ data: string | null; error: Error | null }>;
  }).rpc('default_workspace_id');
  if (workspace.error || !workspace.data) return undefined;
  return { client, userId: data.user.id, workspaceId: workspace.data };
}

export async function uploadTeacherMemorandum(unitId: string, file: File): Promise<{
  storagePath: string;
  checksum: string;
}> {
  const context = await currentClient();
  if (!context) {
    const ownerId = await currentOwnerId();
    if (ownerId) await enqueueMemorandaUpload(ownerId, unitId, file);
    throw new Error('تم حفظ رفع المذكرة محلياً، وستتم المحاولة عند عودة الاتصال.');
  }
  try {
    return await uploadTeacherMemorandumWithContext(context, unitId, file);
  } catch (error) {
    await enqueueMemorandaUpload(context.userId, unitId, file);
    throw error;
  }
}

async function uploadTeacherMemorandumWithContext(
  context: { client: Client; userId: string; workspaceId: string },
  unitId: string,
  file: Blob & { name?: string },
): Promise<{ storagePath: string; checksum: string }> {
  const checksum = await checksumForBlob(file);
  const storagePath = `users/${context.userId}/${unitId}/current.pdf`;
  const existing = await context.client
    .from('memoranda_files')
    .select('id,storage_path,revision')
    .eq('owner_id', context.userId)
    .eq('workspace_id' as never, context.workspaceId)
    .eq('unit_key', unitId)
    .eq('is_bundled', false)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const upload = await context.client.storage.from(BUCKET).upload(storagePath, file, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const metadata = existing.data
    ? await context.client.from('memoranda_files').update({
        file_name: file.name || `${unitId}.pdf`,
        storage_path: storagePath,
        file_size: file.size,
        checksum,
        mime_type: 'application/pdf',
        revision: existing.data.revision + 1,
        deleted_at: null,
      }).eq('id', existing.data.id).eq('owner_id', context.userId).eq('workspace_id' as never, context.workspaceId)
    : await context.client.from('memoranda_files').insert({
        workspace_id: context.workspaceId,
        owner_id: context.userId,
        unit_id: null,
        unit_key: unitId,
        file_name: file.name || `${unitId}.pdf`,
        storage_path: storagePath,
        file_size: file.size,
        checksum,
        mime_type: 'application/pdf',
        is_bundled: false,
        revision: 1,
        deleted_at: null,
      } as never);
  if (metadata.error) throw metadata.error;
  if (existing.data && existing.data.storage_path !== storagePath) {
    const removed = await context.client.storage.from(BUCKET).remove([existing.data.storage_path]);
    if (removed.error) throw removed.error;
  }

  return { storagePath, checksum };
}

/**
 * Flushes only the operations queued by the authenticated owner. Operations queued by a
 * previous account on a shared device are never uploaded into the current one.
 */
export async function flushMemorandaOutbox(ownerId: string): Promise<void> {
  const entries = await listMemorandaOutbox(ownerId);
  if (entries.length === 0) return;
  const context = await currentClient();
  if (!context || context.userId !== ownerId) {
    throw new Error('لا توجد جلسة مستخدم صالحة لمزامنة المذكرات.');
  }
  for (const operation of entries) {
    if (operation.action === 'upload') {
      await uploadTeacherMemorandumWithContext(context, operation.unitId, operation.file);
    } else {
      await deleteTeacherMemorandumWithContext(context, operation.storagePath);
    }
    await removeMemorandaOutboxEntry(ownerId, operation.id);
  }
}

export async function getMemorandumUrl(unitId: string): Promise<string | undefined> {
  const context = await currentClient();
  if (!context) return undefined;
  const owned = await context.client
    .from('memoranda_files')
    .select('storage_path')
    .eq('workspace_id' as never, context.workspaceId)
    .eq('owner_id', context.userId)
    .eq('unit_key', unitId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  const bundled = owned.data ? null : await context.client
    .from('memoranda_files')
    .select('storage_path')
    .eq('workspace_id' as never, context.workspaceId)
    .eq('owner_id', context.userId)
    .eq('is_bundled', true)
    .like('storage_path', `bundled/%/${unitId}.pdf`)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  const metadata = owned.data ? owned : bundled;
  if (owned.error || (bundled && bundled.error) || !metadata?.data) return undefined;
  const signed = await context.client.storage
    .from(BUCKET)
    .createSignedUrl(metadata.data.storage_path, SIGNED_URL_TTL_SECONDS);
  return signed.error ? undefined : signed.data.signedUrl;
}

export async function deleteTeacherMemorandum(storagePath: string): Promise<void> {
  const context = await currentClient();
  if (!context) {
    const ownerId = await currentOwnerId();
    if (ownerId) await enqueueMemorandaDelete(ownerId, storagePath);
    throw new Error('تم حفظ حذف المذكرة محلياً، وستتم المحاولة عند عودة الاتصال.');
  }
  try {
    await deleteTeacherMemorandumWithContext(context, storagePath);
  } catch (error) {
    await enqueueMemorandaDelete(context.userId, storagePath);
    throw error;
  }
}

async function deleteTeacherMemorandumWithContext(
  context: { client: Client; userId: string; workspaceId: string },
  storagePath: string,
): Promise<void> {
  const removed = await context.client.storage.from(BUCKET).remove([storagePath]);
  if (removed.error) throw removed.error;
  const metadata = await context.client
    .from('memoranda_files')
    .delete()
    .eq('storage_path', storagePath)
    .eq('owner_id', context.userId)
    .eq('workspace_id' as never, context.workspaceId);
  if (metadata.error) throw metadata.error;
}
