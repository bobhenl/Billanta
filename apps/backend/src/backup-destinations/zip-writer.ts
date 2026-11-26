import { crc32, deflateRawSync } from "node:zlib";

/**
 * Streams a ZIP file entry by entry, so the archive download never holds more
 * than one document in memory. Sizes and CRC are known before each local
 * header (the document is generated first), so no data descriptors are
 * needed and every unzip tool reads it. Names are flagged UTF-8 (bit 11) for
 * Czech and Slovak file names. No ZIP64: one archive stays under 4 GB and
 * 65 535 files, and `add` refuses to go past that rather than write a broken
 * file.
 */
export type ZipSink = (chunk: Buffer) => void | Promise<void>;

interface CentralEntry {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

const UTF8_FLAG = 0x0800;
const MAX_U32 = 0xffffffff;

/** MS-DOS date/time fields (local time, 2-second resolution). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private readonly entries: CentralEntry[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private finished = false;

  constructor(private readonly sink: ZipSink) {}

  get count(): number {
    return this.entries.length;
  }

  async add(name: string, data: Buffer, modified: Date = new Date()): Promise<void> {
    if (this.finished) throw new Error("zip already finished");
    if (this.names.has(name)) throw new Error(`duplicate zip entry: ${name}`);
    if (this.entries.length >= 0xffff) throw new Error("archive_too_large");
    const deflated = deflateRawSync(data);
    // Already-compressed files (PDF, images, age) are stored as they are.
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const nameBuf = Buffer.from(name, "utf8");
    if (this.offset + 30 + nameBuf.length + body.length > MAX_U32) throw new Error("archive_too_large");
    const crc = crc32(data);
    const { time, date } = dosDateTime(modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    this.entries.push({ name: nameBuf, crc, method, compressed: body.length, size: data.length, offset: this.offset, time, date });
    this.names.add(name);
    this.offset += local.length + nameBuf.length + body.length;
    await this.sink(Buffer.concat([local, nameBuf]));
    await this.sink(body);
  }

  /** Writes the central directory; the ZIP is complete after this. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const heads: Buffer[] = [];
    for (const e of this.entries) {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(20, 6);
      head.writeUInt16LE(UTF8_FLAG, 8);
      head.writeUInt16LE(e.method, 10);
      head.writeUInt16LE(e.time, 12);
      head.writeUInt16LE(e.date, 14);
      head.writeUInt32LE(e.crc, 16);
      head.writeUInt32LE(e.compressed, 20);
      head.writeUInt32LE(e.size, 24);
      head.writeUInt16LE(e.name.length, 28);
      head.writeUInt32LE(e.offset, 42);
      heads.push(head, e.name);
    }
    const central = Buffer.concat(heads);
    if (this.offset + central.length > MAX_U32) throw new Error("archive_too_large");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(this.offset, 16);
    await this.sink(Buffer.concat([central, end]));
  }
}
