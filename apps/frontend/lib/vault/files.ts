import { openFile, openFileMeta, sealFile, type VaultKey } from '@faktur/cz-compliance';
import type { EnabledVault } from './types';

/*
 * Browser side of the "attachments" category: files are encrypted before
 * upload and decrypted after download, so the server only ever holds
 * ciphertext. The key never leaves this tab.
 */

/** Whether new uploads get encrypted: the category is on and the plan still allows it. */
export const encryptsFiles = (vault: EnabledVault | null) => Boolean(vault?.categories.includes('attachments') && vault.planAllowed !== false);

/** The multipart body for an encrypted upload: ciphertext under a neutral name, plus the sealed key, name and type. */
export async function encryptedUpload(key: VaultKey, file: Blob, name: string): Promise<FormData> {
  const sealed = await sealFile(key, new Uint8Array(await file.arrayBuffer()), { name, mime: file.type || 'application/octet-stream' });
  const body = new FormData();
  body.set('file', new Blob([sealed.body as BlobPart], { type: 'application/octet-stream' }), 'encrypted.bin');
  body.set('enc_meta', sealed.encMeta);
  return body;
}

/** Downloads a stored file and decrypts it here. */
export async function fetchDecrypted(url: string, key: VaultKey, encMeta: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed_${res.status}`);
  const opened = await openFile(key, new Uint8Array(await res.arrayBuffer()), encMeta);
  return new File([opened.bytes as BlobPart], opened.name, { type: opened.mime });
}

/** Real names for a file list; a row that fails to open keeps no name (shown as encrypted). */
export async function decryptNames(key: VaultKey, rows: { id: string; encMeta: string | null }[]): Promise<Record<string, { name: string; mime: string }>> {
  const out: Record<string, { name: string; mime: string }> = {};
  await Promise.all(
    rows.map(async (row) => {
      if (!row.encMeta) return;
      try {
        out[row.id] = await openFileMeta(key, row.encMeta);
      } catch {
        // Left out: the row shows as encrypted.
      }
    })
  );
  return out;
}

/** Saves a decrypted file with its real name, without the server seeing it. */
export function saveLocally(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Types the preview can show inline: images and PDF. */
export const previewable = (mime: string) => mime === 'application/pdf' || /^image\/(png|jpeg|webp|gif)$/.test(mime);
