import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MAX_SEALED_ISDOC_BYTES, MAX_SEALED_PDF_BYTES, sealedSendFiles, type UploadedPart } from "./sealed-send-files";

const part = (body: string | Buffer, mimetype: string): UploadedPart => {
  const buffer = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return { buffer, size: buffer.length, mimetype };
};
const pdf = () => part("%PDF-1.3\n%…\n%%EOF", "application/pdf");
const isdoc = (head = '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">') =>
  part(`${head}</Invoice>`, "application/xml");

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return { type: (error as object).constructor, message: (error as Error).message };
  }
  return null;
};

describe("sealedSendFiles", () => {
  it("passes a real PDF and ISDOC through unchanged", () => {
    const files = sealedSendFiles({ pdf: [pdf()], isdoc: [isdoc()] });
    expect(files.pdf?.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(files.isdoc?.toString("utf8")).toContain("<Invoice");
    expect(sealedSendFiles({ isdoc: [part(`﻿${isdoc().buffer.toString("utf8")}`, "text/xml")] }).isdoc).toBeDefined();
  });

  it("needs at least one file, and one of each at most", () => {
    expect(code(() => sealedSendFiles(undefined))).toEqual({ type: BadRequestException, message: "no_file" });
    expect(code(() => sealedSendFiles({}))).toEqual({ type: BadRequestException, message: "no_file" });
    expect(code(() => sealedSendFiles({ pdf: [pdf(), pdf()] }))).toEqual({ type: BadRequestException, message: "too_many_files" });
  });

  it("checks the content, not just the declared type", () => {
    expect(code(() => sealedSendFiles({ pdf: [part("<html>", "application/pdf")] }))?.message).toBe("invalid_pdf");
    expect(code(() => sealedSendFiles({ pdf: [part("%PDF-1.3", "text/html")] }))?.message).toBe("invalid_pdf");
    expect(code(() => sealedSendFiles({ isdoc: [part("<html><Invoice>", "application/xml")] }))?.message).toBe("invalid_isdoc");
    expect(code(() => sealedSendFiles({ isdoc: [part(isdoc().buffer, "text/html")] }))?.message).toBe("invalid_isdoc");
    expect(code(() => sealedSendFiles({ isdoc: [isdoc('<?xml version="1.0"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">')] }))?.message).toBe("invalid_isdoc");
    expect(code(() => sealedSendFiles({ isdoc: [isdoc('<?xml version="1.0"?>\n<Order xmlns="http://isdoc.cz/namespace/2013">')] }))?.message).toBe("invalid_isdoc");
  });

  it("refuses files over the limits", () => {
    const bigPdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_SEALED_PDF_BYTES)]);
    expect(code(() => sealedSendFiles({ pdf: [part(bigPdf, "application/pdf")] }))).toEqual({ type: PayloadTooLargeException, message: "file_too_large" });
    const bigIsdoc = Buffer.concat([isdoc().buffer, Buffer.alloc(MAX_SEALED_ISDOC_BYTES)]);
    expect(code(() => sealedSendFiles({ isdoc: [part(bigIsdoc, "application/xml")] }))).toEqual({ type: PayloadTooLargeException, message: "file_too_large" });
  });
});
