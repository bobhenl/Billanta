import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ENCRYPTED_FILE_OVERHEAD, isEncryptedFile, isSealed } from "@faktur/cz-compliance";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { assertSealingAllowed } from "./sealed";

/*
 * Server side of the "attachments" category. An encrypted file arrives as
 * `MAGIC | IV | ciphertext` plus `enc_meta`, an `enc:v1:` envelope with the
 * file key, the real name and the MIME type (confidential-files.ts). The
 * server stores both as they are and never treats such a body as a file it
 * could read: no preview, no AI, no e-mail attachment, no client portal.
 */

export { isEncryptedFile };

/** What an encrypted row shows instead of the real name and type. */
export const ENCRYPTED_FILENAME = "encrypted.bin";
export const ENCRYPTED_MIME = "application/octet-stream";
/** 409 code: the body is ciphertext, so the server can't read it as a file. */
export const ENCRYPTED_FILE = "encrypted_file";

/** Key, name and type in one envelope: a 200-char name fits with lots of room. */
const MAX_ENC_META = 4000;

export interface UploadedFileLike {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** Refuses ciphertext wherever the server would read the file (AI, e-mail, preview). */
export function assertPlainFile(buffer: Uint8Array): void {
  if (isEncryptedFile(buffer)) throw new ConflictException(ENCRYPTED_FILE);
}

/**
 * Sorts an upload into plain or encrypted. `enc_meta` and an encrypted body
 * come together or not at all: a plain upload that is really ciphertext (or
 * the other way round) is refused, so nothing stores ciphertext as a
 * readable file. Returns the envelope for an encrypted upload, else null.
 */
export function classifyUpload(file: UploadedFileLike, encMeta: unknown, maxPlainBytes: number): string | null {
  const hasMeta = typeof encMeta === "string" && encMeta.length > 0;
  if (!hasMeta) {
    assertPlainFile(file.buffer);
    return null;
  }
  if (encMeta.length > MAX_ENC_META || !isSealed(encMeta)) throw new BadRequestException({ error: "bad_enc_meta" });
  if (!isEncryptedFile(file.buffer)) throw new BadRequestException({ error: "not_encrypted" });
  if (file.size > maxPlainBytes + ENCRYPTED_FILE_OVERHEAD) throw new BadRequestException({ error: "too_big" });
  return encMeta;
}

/** Multer's cap: the plain limit plus what encryption adds. */
export const encryptedLimit = (maxPlainBytes: number) => maxPlainBytes + ENCRYPTED_FILE_OVERHEAD;

/**
 * An encrypted upload needs the Plus plan (like `assertSealingAllowed` for
 * texts) and a vault with the "attachments" category switched on, so a stray
 * client can't store files nobody in the company can open.
 */
export async function assertFileSealingAllowed(db: PostgresJsDatabase<typeof schema>, tenantId: string, encMeta: string): Promise<void> {
  await assertSealingAllowed(db, tenantId, [encMeta]);
  const [vault] = await db
    .select({ categories: schema.tenantVaults.categories })
    .from(schema.tenantVaults)
    .where(eq(schema.tenantVaults.tenantId, tenantId))
    .limit(1);
  if (!vault?.categories.includes("attachments")) throw new ForbiddenException("vault_category_off");
}
