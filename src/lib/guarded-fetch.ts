import { lookup, promises as dnsPromises, type LookupAddress, type LookupOptions } from "node:dns";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

/**
 * Whether a host is one the server should refuse to fetch.
 *
 * Most fetches in this app aim at a URL nobody outside it chose — a configured
 * feed. A pasted library link does not, and neither does the article link in
 * a Hacker News or newsletter item, which a stranger submitted. The server
 * sits on a private network beside a database, a tailnet and the cloud's
 * metadata service, so an unfiltered fetch would let any of those links reach
 * them and store what it found where the reader can read it back.
 *
 * Takes a hostname or a literal address, bracketed or not. On its own it only
 * judges what it is shown: a public name that resolves to a private address
 * passes. `guardedFetch` closes that by asking again, at connect time, of
 * every address the name actually resolved to.
 */
export function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // .ts.net is Tailscale's MagicDNS: names under it resolve to tailnet peers.
  if (/\.(local|internal|home|lan|ts\.net)$/.test(host)) return true;
  if (host === "::" || host === "::1" || host.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(host)) return true;

  // IPv4-mapped IPv6 connects to the IPv4 address it carries, so it has to
  // face the same rules. The URL parser rewrites the dotted spelling into hex —
  // [::ffff:127.0.0.1] arrives here as ::ffff:7f00:1 — so both are unpacked.
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const [hi, lo] = mappedHex.slice(1).map((h) => parseInt(h, 16));
    host = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  } else if (host.startsWith("::ffff:")) {
    host = host.slice("::ffff:".length);
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    return (
      a === 0 ||
      a === 10 ||
      // Carrier-grade NAT space, which is where every Tailscale address lives.
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  return false;
}

/**
 * Whether a URL's host is internal, either as written or by what it resolves
 * to now. For telling the reader why a link was refused before anything is
 * fetched — not for enforcement, since the answer can change by the time a
 * connection is made. `guardedFetch` is what actually holds the line.
 */
export async function pointsInside(url: string): Promise<boolean> {
  const { hostname } = new URL(url);
  if (isBlockedHost(hostname)) return true;
  const addresses = await dnsPromises.lookup(hostname.replace(/^\[|\]$/g, ""), { all: true }).catch(() => []);
  return addresses.some((a) => isBlockedHost(a.address));
}

function refused(target: string): Error {
  return Object.assign(new Error(`Refused to connect to internal address ${target}`), {
    code: "EINTERNALADDRESS",
  });
}

/**
 * DNS lookup that fails rather than hand the socket an internal address.
 *
 * The check runs on the very answer the socket is about to connect to, so a
 * name cannot pass here and then resolve somewhere else for the connection
 * itself — the gap a check-then-fetch leaves open. Node asks for every
 * address at once (`all: true`) so it can race IPv4 against IPv6; one
 * internal address in the set refuses the lot, since any of them may be the
 * one it picks.
 */
function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const blocked = addresses.find((a) => isBlockedHost(a.address));
    if (blocked) return callback(refused(`${blocked.address} (${hostname})`), []);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const connect = buildConnector({ lookup: guardedLookup });

// A literal IP never reaches a lookup — Node connects to it directly — so the
// connector checks the host it is handed as well. Together they cover every
// connection, including each hop of a followed redirect, which opens its own.
const guardedAgent = new Agent({
  connect(options, callback) {
    if (isBlockedHost(options.hostname)) {
      callback(refused(options.hostname), null);
      return;
    }
    connect(options, callback);
  },
});

/**
 * `fetch` for URLs someone outside the app chose. Refuses, at connect time,
 * any connection to an internal address — the pasted host, whatever it
 * resolves to, and wherever a redirect leads. A refusal rejects like any
 * other network failure, so callers' existing error handling covers it.
 *
 * undici's own `fetch`, not the global one, so the agent and the fetch that
 * drives it are always the same version.
 */
export function guardedFetch(
  url: string,
  init: Parameters<typeof undiciFetch>[1] = {}
): ReturnType<typeof undiciFetch> {
  return undiciFetch(url, { ...init, dispatcher: guardedAgent });
}
