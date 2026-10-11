import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server, utils } from "ssh2";
import { ageEncrypt } from "./age.util";
import { generateSftpKeyPair, hostKeyFingerprint, remoteFilePath, SftpBackupClient } from "./sftp.client";

const { STATUS_CODE } = utils.sftp;

/** A tiny in-memory SFTP server: accepts one public key, stores written files. */
function startServer(allowedPublicKey: string) {
  const hostKey = utils.generateKeyPairSync("ed25519");
  const allowed = utils.parseKey(allowedPublicKey);
  if (allowed instanceof Error) throw allowed;
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey" && ctx.username === "backup" && ctx.key.data.equals(allowed.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept();
        return allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject();
      }
      ctx.reject(["publickey"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        accept().on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const open = new Map<number, string>();
          let next = 0;
          const stat = (reqid: number, path: string) => {
            if (dirs.has(path)) return sftp.attrs(reqid, { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 });
            const f = files.get(path);
            if (f) return sftp.attrs(reqid, { mode: 0o100644, uid: 0, gid: 0, size: f.length, atime: 0, mtime: 0 });
            sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          };
          sftp
            .on("REALPATH", (reqid, path) => sftp.name(reqid, [{ filename: path === "." ? "/" : path, longname: "", attrs: {} as never }]))
            .on("STAT", stat)
            .on("LSTAT", stat)
            .on("MKDIR", (reqid, path) => {
              dirs.add(path);
              sftp.status(reqid, STATUS_CODE.OK);
            })
            .on("OPEN", (reqid, filename) => {
              const handle = Buffer.alloc(4);
              handle.writeUInt32BE(next, 0);
              open.set(next++, filename);
              files.set(filename, Buffer.alloc(0));
              sftp.handle(reqid, handle);
            })
            .on("WRITE", (reqid, handle, offset, data) => {
              const name = open.get(handle.readUInt32BE(0))!;
              const cur = files.get(name)!;
              const out = Buffer.alloc(Math.max(cur.length, offset + data.length));
              cur.copy(out);
              data.copy(out, offset);
              files.set(name, out);
              sftp.status(reqid, STATUS_CODE.OK);
            })
            .on("FSTAT", (reqid, handle) => stat(reqid, open.get(handle.readUInt32BE(0))!))
            .on("CLOSE", (reqid, handle) => {
              open.delete(handle.readUInt32BE(0));
              sftp.status(reqid, STATUS_CODE.OK);
            });
        });
      });
    });
    client.on("error", () => undefined);
  });

  const parsedHost = utils.parseKey(hostKey.public);
  if (parsedHost instanceof Error) throw parsedHost;
  return { server, files, dirs, fingerprint: hostKeyFingerprint(parsedHost.getPublicSSH()) };
}

describe("SftpBackupClient", () => {
  const keys = generateSftpKeyPair();
  const sftp = startServer(keys.publicKey);
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => sftp.server.listen(0, "127.0.0.1", resolve));
    port = (sftp.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => sftp.server.close(() => resolve())));

  const target = (fingerprint: string | null) => ({
    host: "127.0.0.1",
    port,
    username: "backup",
    path: "billanta-zalohy",
    privateKey: keys.privateKey,
    fingerprint,
  });

  it("uploads with the generated key, creates the folder and returns the host key to pin", async () => {
    const content = Buffer.from("SQLite format 3\0 backup");
    const { fingerprint } = await new SftpBackupClient().upload(target(null), "zaloha.db", content);

    expect(fingerprint).toBe(sftp.fingerprint);
    expect(sftp.dirs.has("billanta-zalohy")).toBe(true);
    expect(sftp.files.get("billanta-zalohy/zaloha.db")?.equals(content)).toBe(true);
  });

  it("refuses a server whose host key differs from the pinned one", async () => {
    await expect(new SftpBackupClient().upload(target("SHA256:somethingelse"), "x.db", Buffer.from("x"))).rejects.toThrow(
      /host key changed/,
    );
  });

  it("uploads age-encrypted content that is not the plaintext", async () => {
    const plain = Buffer.from("tajná data faktur");
    const out = await ageEncrypt(plain, { passphrase: "dlouhe-heslo-123" });
    expect(out.encrypted).toBe(true);
    expect(Buffer.from(out.data).subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    expect(Buffer.from(out.data).includes(plain)).toBe(false);
  });
});

describe("remoteFilePath", () => {
  it("joins without doubled slashes", () => {
    expect(remoteFilePath("zalohy/", "a.db")).toBe("zalohy/a.db");
    expect(remoteFilePath("/srv/b/", "a.db")).toBe("/srv/b/a.db");
    expect(remoteFilePath("", "a.db")).toBe("a.db");
  });
});

describe("ageEncrypt", () => {
  it("leaves data unchanged without a key or passphrase", async () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(await ageEncrypt(data, {})).toEqual({ data, encrypted: false });
  });

  it("round-trips with an age key pair", async () => {
    const age = await import("age-encryption");
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const out = await ageEncrypt(new TextEncoder().encode("faktura 2026-0001"), { recipient });
    const d = new age.Decrypter();
    d.addIdentity(identity);
    expect(await d.decrypt(out.data, "text")).toBe("faktura 2026-0001");
  });
});
