/**
 * Minimal DER reader, just enough for PKCS#12 (RFC 7292) and X.509. No
 * dependency on an ASN.1 library: the package stays framework-free and the
 * subset needed here is small.
 */

export interface DerNode {
  /** Full identifier octet (class, constructed bit and tag number). */
  tag: number;
  constructed: boolean;
  /** Content octets (without the header). */
  value: Uint8Array;
  /** The whole TLV, header included. */
  raw: Uint8Array;
}

export const TAG = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
  SET: 0x31,
  /** [0] constructed, context-specific. */
  CTX0: 0xa0,
  /** [0] primitive, context-specific (IMPLICIT OCTET STRING in EncryptedContentInfo). */
  CTX0_PRIMITIVE: 0x80,
} as const;

export class DerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerError';
  }
}

/** Reads one TLV at `offset`. Indefinite lengths are BER, not DER, but some PKCS#12 writers use them. */
export function readNode(buf: Uint8Array, offset = 0): { node: DerNode; next: number } {
  if (offset + 2 > buf.length) throw new DerError('truncated');
  const tag = buf[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new DerError('high tag numbers are not supported');
  let pos = offset + 1;
  const first = buf[pos++]!;
  const constructed = (tag & 0x20) !== 0;
  if (first === 0x80) {
    // Indefinite length (BER): children until the 00 00 end-of-contents.
    if (!constructed) throw new DerError('indefinite length on a primitive');
    const start = pos;
    while (true) {
      if (pos + 2 > buf.length) throw new DerError('truncated');
      if (buf[pos] === 0 && buf[pos + 1] === 0) break;
      pos = readNode(buf, pos).next;
    }
    return {
      node: { tag, constructed, value: buf.subarray(start, pos), raw: buf.subarray(offset, pos + 2) },
      next: pos + 2,
    };
  }
  let len = first;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n > 4) throw new DerError('length too large');
    len = 0;
    for (let i = 0; i < n; i++) {
      if (pos >= buf.length) throw new DerError('truncated');
      len = len * 256 + buf[pos++]!;
    }
  }
  const end = pos + len;
  if (end > buf.length) throw new DerError('truncated');
  return { node: { tag, constructed, value: buf.subarray(pos, end), raw: buf.subarray(offset, end) }, next: end };
}

export function parseDer(buf: Uint8Array): DerNode {
  return readNode(buf, 0).node;
}

export function children(node: DerNode): DerNode[] {
  if (!node.constructed) throw new DerError('not a constructed node');
  const out: DerNode[] = [];
  let pos = 0;
  while (pos < node.value.length) {
    const { node: child, next } = readNode(node.value, pos);
    out.push(child);
    pos = next;
  }
  return out;
}

export function expect(node: DerNode | undefined, tag: number, what: string): DerNode {
  if (!node || node.tag !== tag) throw new DerError(`expected ${what}`);
  return node;
}

/** Child `i` of a constructed node, checked against `tag`. */
export function child(node: DerNode, i: number, tag: number, what: string): DerNode {
  return expect(children(node)[i], tag, what);
}

export function oid(node: DerNode): string {
  expect(node, TAG.OID, 'OID');
  const v = node.value;
  if (v.length === 0) throw new DerError('empty OID');
  const parts: number[] = [];
  const first = v[0]!;
  parts.push(first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80);
  let acc = 0;
  for (let i = 1; i < v.length; i++) {
    acc = acc * 128 + (v[i]! & 0x7f);
    if ((v[i]! & 0x80) === 0) {
      parts.push(acc);
      acc = 0;
    }
  }
  // The first arc can also be multi-byte for 2.x with x >= 48; not used by anything here.
  return parts.join('.');
}

export function integer(node: DerNode): number {
  expect(node, TAG.INTEGER, 'INTEGER');
  if (node.value.length > 6) throw new DerError('integer too large');
  let n = 0;
  for (const b of node.value) n = n * 256 + b;
  return n;
}

/**
 * Octet string contents. BER writers may split an OCTET STRING into a
 * constructed sequence of chunks, so those are joined.
 */
export function octets(node: DerNode): Uint8Array {
  if ((node.tag & 0x1f) !== 0x04 && node.tag !== TAG.CTX0_PRIMITIVE && node.tag !== TAG.CTX0) {
    throw new DerError('expected OCTET STRING');
  }
  if (!node.constructed) return node.value;
  const parts = children(node).map(octets);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// --- writing (only what the tests and PKCS#8 re-wrapping need) -----------------

export function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  const bytes: number[] = [];
  while (len > 0) {
    bytes.unshift(len & 0xff);
    len = Math.floor(len / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function tlv(tag: number, value: Uint8Array): Uint8Array {
  const len = encodeLength(value.length);
  const out = new Uint8Array(1 + len.length + value.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(value, 1 + len.length);
  return out;
}
