import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const client = createClient(supabaseUrl, serviceRoleKey);
const root = path.resolve(process.cwd(), 'public/memoranda');

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return files.flat().filter(file => file.toLowerCase().endsWith('.pdf'));
}

for (const filePath of await walk(root)) {
  const bytes = await readFile(filePath);
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  const storagePath = `bundled/${relative}`;
  const upload = await client.storage.from('memoranda').upload(storagePath, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const digest = await checksum(bytes);
  const { data: workspaces, error: workspaceError } = await client
    .from('workspaces')
    .select('id,owner_id');
  if (workspaceError) throw workspaceError;
  for (const workspace of workspaces) {
    const existing = await client
      .from('memoranda_files')
      .select('id')
      .eq('workspace_id', workspace.id)
      .eq('storage_path', storagePath)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const metadata = existing.data
      ? await client.from('memoranda_files').update({
          file_name: path.basename(filePath),
          file_size: bytes.byteLength,
          checksum: digest,
          mime_type: 'application/pdf',
          is_bundled: true,
          deleted_at: null,
        }).eq('id', existing.data.id).eq('workspace_id', workspace.id)
      : await client.from('memoranda_files').insert({
          workspace_id: workspace.id,
          owner_id: workspace.owner_id,
          unit_id: null,
          file_name: path.basename(filePath),
          storage_path: storagePath,
          file_size: bytes.byteLength,
          checksum: digest,
          mime_type: 'application/pdf',
          is_bundled: true,
          revision: 0,
          deleted_at: null,
        });
    if (metadata.error) throw metadata.error;
  }
  console.log(`Seeded ${relative}`);
}
