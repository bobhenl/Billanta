import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { SealedDocumentFiles } from "./invoices.service";

/** Same ceiling as an uploaded attachment; a one-page invoice is far below it. */
export const MAX_SEALED_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_SEALED_ISDOC_BYTES = 2 * 1024 * 1024;

export interface UploadedPart {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const ISDOC_NAMESPACE = "http://isdoc.cz/namespace/2013";

/**
 * Checks the files the browser rendered for a sealed invoice before they go
 * out under the company's name: only a PDF and an ISDOC, by content and not
 * just by the declared type, within the size limits. The server names the
 * files itself, so the upload's own filename is ignored.
 */
export function sealedSendFiles(parts: { pdf?: UploadedPart[]; isdoc?: UploadedPart[] } | undefined): SealedDocumentFiles {
  const pdf = parts?.pdf?.[0];
  const isdoc = parts?.isdoc?.[0];
  if (!pdf && !isdoc) throw new BadRequestException("no_file");
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
  return files;
}
