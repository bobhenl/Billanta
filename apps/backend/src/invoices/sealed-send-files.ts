import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { UploadedFileLike } from "../vault/sealed-files";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_INVOICE, passThroughFiles } from "./invoice-attachments.service";
import type { SealedDocumentFiles } from "./invoices.service";

/** Same ceiling as an uploaded attachment; a one-page invoice is far below it. */
export const MAX_SEALED_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_SEALED_ISDOC_BYTES = 2 * 1024 * 1024;
/** Multer's per-file cap for the one-time send: the largest of the three kinds. */
export const MAX_ONE_TIME_FILE_BYTES = Math.max(MAX_SEALED_PDF_BYTES, MAX_SEALED_ISDOC_BYTES, MAX_ATTACHMENT_BYTES);
export const MAX_ONE_TIME_FILES = 2 + MAX_ATTACHMENTS_PER_INVOICE;

export interface UploadedPart {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const ISDOC_NAMESPACE = "http://isdoc.cz/namespace/2013";

/**
 * Checks the files the browser made or decrypted for one e-mail before they
 * go out under the company's name. `pdf`/`isdoc` are a sealed invoice's own
 * documents: by content and not just by the declared type, within the size
 * limits, named by the server (the upload's filename is ignored). `files` are
 * decrypted attachments, checked like any attachment and refused if they are
 * still ciphertext.
 */
export function sealedSendFiles(
  parts: { pdf?: UploadedPart[]; isdoc?: UploadedPart[]; files?: UploadedFileLike[] } | undefined,
): SealedDocumentFiles {
  const pdf = parts?.pdf?.[0];
  const isdoc = parts?.isdoc?.[0];
  const extra = passThroughFiles(parts?.files ?? []);
  if (!pdf && !isdoc && !extra.length) throw new BadRequestException("no_file");
  if ((parts?.pdf?.length ?? 0) > 1 || (parts?.isdoc?.length ?? 0) > 1) throw new BadRequestException("too_many_files");
  const files: SealedDocumentFiles = {};
  if (pdf) {
    if (pdf.size > MAX_SEALED_PDF_BYTES || pdf.buffer.length > MAX_SEALED_PDF_BYTES) throw new PayloadTooLargeException("file_too_large");
    if (pdf.mimetype !== "application/pdf" || pdf.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new BadRequestException("invalid_pdf");
    }
    files.pdf = pdf.buffer;
  }
  if (isdoc) {
    if (isdoc.size > MAX_SEALED_ISDOC_BYTES || isdoc.buffer.length > MAX_SEALED_ISDOC_BYTES) throw new PayloadTooLargeException("file_too_large");
    const head = isdoc.buffer.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
    const xmlType = isdoc.mimetype === "application/xml" || isdoc.mimetype === "text/xml";
    if (!xmlType || !head.startsWith("<?xml") || !/<Invoice\b/.test(head) || !head.includes(ISDOC_NAMESPACE)) {
      throw new BadRequestException("invalid_isdoc");
    }
    files.isdoc = isdoc.buffer;
  }
  if (extra.length) files.extra = extra;
  return files;
}
