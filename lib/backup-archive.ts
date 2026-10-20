import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { binaryKeyForPdf, loadPdfBinary, savePdfBinary } from './binary-storage';
import type { AppState } from './storage';

interface PdfArchiveManifestEntry {
  unitId: string;
  fileName: string;
  storageKey: string;
  archivePath: string;
  checksum: string;
}

interface PdfArchiveManifest {
  version: 1;
  createdAt: string;
  files: PdfArchiveManifestEntry[];
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('ملف PDF المحلي غير صالح.');
  const binary = atob(dataUrl.slice(comma + 1));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

async function checksumForBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPdfBackupArchive(state: AppState, ownerId?: string | null): Promise<Uint8Array> {
  const files: PdfArchiveManifestEntry[] = [];
  const archive: Record<string, Uint8Array> = {};

  for (const [unitId, file] of Object.entries(state.unitPdfFiles || {})) {
    if (!file.fileStorageKey && !file.fileDataUrl) continue;
    // Scoped read: works for the owner-scoped key and migrates legacy unscoped entries.
    const dataUrl = await loadPdfBinary(unitId, ownerId) ?? file.fileDataUrl;
    if (!dataUrl) continue;
    const archivePath = `pdfs/${unitId}.pdf`;
    archive[archivePath] = dataUrlToBytes(dataUrl);
    files.push({
      unitId,
      fileName: file.fileName,
      storageKey: binaryKeyForPdf(unitId, ownerId),
      archivePath,
      checksum: await checksumForBytes(archive[archivePath]),
    });
  }

  const manifest: PdfArchiveManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    files,
  };
  archive['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(archive, { level: 6 });
}

export async function restorePdfBackupArchive(
  archiveFile: Blob,
  ownerId?: string | null,
): Promise<NonNullable<AppState['unitPdfFiles']>> {
  const files = unzipSync(new Uint8Array(await archiveFile.arrayBuffer()));
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('أرشيف PDF لا يحتوي على manifest صالح.');
  const manifest = JSON.parse(strFromU8(manifestBytes)) as PdfArchiveManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('إصدار أرشيف PDF غير مدعوم.');
  }

  const restored: NonNullable<AppState['unitPdfFiles']> = {};
  for (const entry of manifest.files) {
    const bytes = files[entry.archivePath];
    if (!bytes) throw new Error(`الملف مفقود من الأرشيف: ${entry.fileName}`);
    if (entry.checksum && entry.checksum !== await checksumForBytes(bytes)) {
      throw new Error(`فشل التحقق من سلامة الملف: ${entry.fileName}`);
    }
    // Always re-key for the current owner: a restored archive must never be readable by
    // (or leak into) the account that produced it on a shared device.
    const storageKey = await savePdfBinary(entry.unitId, bytesToDataUrl(bytes), ownerId);
    restored[entry.unitId] = {
      fileName: entry.fileName,
      fileStorageKey: storageKey,
      uploadedAt: new Date().toISOString().split('T')[0],
    };
  }
  return restored;
}
