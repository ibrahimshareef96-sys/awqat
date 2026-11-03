/**
 * The speech worker's own fence. The page's Content-Security-Policy does not reach a worker started from one of the
 * app's files (the worker has no policy of its own), so this stands in for its connect-src: a fetch or an
 * XMLHttpRequest to anything but the app's own files is refused before it goes. It is the worker's first import, so it
 * is in place before either library runs. ONNX Runtime loads its own runtime with import(), which no fence here sees,
 * and by default from a CDN: worker.ts points it at the copy inside the app, and refuses any address that is not one
 * of the app's own files (ownFile).
 */

/** Capacitor's native proxies (http and https): same-origin paths that would fetch any site, were they turned on. */
const NATIVE_PROXY = "/_capacitor_http";

/**
 * Whether `href` is one of the app's own files: a plain string with the scheme and host of `here` (the worker's own
 * address), and never Capacitor's proxy. On Android that is https://localhost, on iOS the app's own scheme; a path
 * resolves onto it. Anything else is not, a data: or blob: address included (worker.ts would import it as code).
 */
export function ownFile(href: unknown, here: string): boolean {
  if (typeof href !== "string") return false;
  try {
    const url = new URL(href, here);
    const own = new URL(here);
    return url.protocol === own.protocol && url.host === own.host && !url.pathname.startsWith(NATIVE_PROXY);
  } catch {
    return false;
  }
}

/** What the fence lets a read reach: the app's own files, and data: and blob: addresses, which never leave the phone. */
function readable(href: string, here: string): boolean {
  try {
    const { protocol } = new URL(href, here);
    return protocol === "data:" || protocol === "blob:" || ownFile(href, here);
  } catch {
    return false;
  }
}

const refusal = (href: string, here: string): TypeError => {
  let origin = "an address that is not one";
  try {
    origin = new URL(href, here).origin;
  } catch {
    // The address does not parse: the message says so.
  }
  return new TypeError(`The speech worker reads only the app's own files, not ${origin}.`);
};

/** `fetch` that refuses anything but what `readable` lets by. The address checked is the one fetched: read once. */
export function sameOriginFetch(inner: typeof fetch, here: string): typeof fetch {
  return (input, init) => {
    if (input instanceof Request) {
      return readable(input.url, here) ? inner(input, init) : Promise.reject(refusal(input.url, here));
    }
    const href = input instanceof URL ? input.href : String(input);
    return readable(href, here) ? inner(href, init) : Promise.reject(refusal(href, here));
  };
}

type Open = (this: XMLHttpRequest, ...args: unknown[]) => void;

/** XMLHttpRequest held to the same files: ONNX Runtime falls back to it when a fetch of its runtime fails. */
export function fenceXhr(xhr: typeof XMLHttpRequest, here: string): void {
  const open = xhr.prototype.open as unknown as Open;
  const fenced: Open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    const url = args[1];
    const href = url instanceof URL ? url.href : String(url);
    if (!readable(href, here)) throw refusal(href, here);
    open.apply(this, [args[0], href, ...args.slice(2)]);
  };
  xhr.prototype.open = fenced as unknown as typeof xhr.prototype.open;
}

interface Scope {
  WorkerGlobalScope?: abstract new () => unknown;
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  location: { href: string };
}
const scope = globalThis as unknown as Scope;
// Only inside a worker: the page has its own policy, and a test that imports this is left as it is.
if (typeof scope.WorkerGlobalScope === "function" && globalThis instanceof scope.WorkerGlobalScope) {
  scope.fetch = sameOriginFetch(scope.fetch.bind(globalThis), scope.location.href);
  if (scope.XMLHttpRequest) fenceXhr(scope.XMLHttpRequest, scope.location.href);
}
