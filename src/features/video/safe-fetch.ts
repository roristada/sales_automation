import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Downloads a user-supplied URL (e.g. a product image) without letting it reach this machine's
 * or the local network's services (SSRF). The address is checked when the socket connects (the
 * custom `lookup`), so a DNS answer can't change between the check and the request, and every
 * redirect hop goes through the same check.
 */

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net4, prefix, "ipv4");
}
for (const [net6, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net6, prefix, "ipv6");
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicAddress(mapped[1]);
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

export class BlockedAddressError extends Error {}

function guardedLookup(hostname: string, options: { all?: boolean }, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return cb(new BlockedAddressError(`ปลายทางไม่ใช่ที่อยู่สาธารณะ (${hostname})`), "");
    }
    if (options.all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}

export interface FetchedFile {
  status: number;
  contentType: string;
  body: Buffer;
}

export async function fetchPublic(rawUrl: string, opts: { timeoutMs: number; maxBytes: number; maxRedirects?: number }): Promise<FetchedFile> {
  let url = new URL(rawUrl);
  const deadline = Date.now() + opts.timeoutMs;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedAddressError("รองรับเฉพาะลิงก์ http(s)");
    if (url.username || url.password) throw new BlockedAddressError("ลิงก์มีชื่อผู้ใช้/รหัสผ่าน");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // IP literals skip DNS, so check them directly.
    if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedAddressError(`ปลายทางไม่ใช่ที่อยู่สาธารณะ (${host})`);

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.get(url, { lookup: guardedLookup as never, timeout: Math.max(1, deadline - Date.now()), headers: { "user-agent": "sales-automation-render/1" } }, resolve);
      req.on("timeout", () => req.destroy(new Error("หมดเวลาเชื่อมต่อ")));
      req.on("error", reject);
    });

    const location = res.headers.location;
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume();
      url = new URL(location, url);
      continue;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > opts.maxBytes) {
          res.destroy();
          reject(new Error(`ไฟล์ใหญ่เกิน ${Math.round(opts.maxBytes / 1024 / 1024)} MB`));
        } else chunks.push(c);
      });
      res.on("end", resolve);
      res.on("error", reject);
      res.setTimeout(Math.max(1, deadline - Date.now()), () => res.destroy(new Error("หมดเวลาดาวน์โหลด")));
    });
    return { status: res.statusCode ?? 0, contentType: res.headers["content-type"]?.split(";")[0].trim() ?? "", body: Buffer.concat(chunks) };
  }
  throw new Error("redirect หลายครั้งเกินไป");
}
