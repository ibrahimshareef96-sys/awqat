/**
 * The speech worker's own fence. The page's Content-Security-Policy does not reach a worker started from one of the
 * app's files (the worker has no policy of its own), so this stands in for its connect-src: a fetch to a web address
 * of another site is refused before it goes. It is the worker's first import, so it is in place before either library
 * runs. It fences fetch only. ONNX Runtime loads its own runtime with import(), which this never sees, and by default
 * from a CDN: worker.ts points it at the copy inside the app, and refuses a runtime address of another site (ownFile).
 */

/** The schemes that reach the network. Anything else (the app's own scheme on iOS, blob:, data:) stays on the phone. */
const WEB = new Set(["http:", "https:", "ws:", "wss:"]);

/** Whether `href` stays on the phone: a web address only of the same origin as `here`, or no web address at all. */
export function ownFile(href: string, here: string): boolean {
  try {
    const url = new URL(href, here);
    return !WEB.has(url.protocol) || url.origin === new URL(here).origin;
  } catch {
    return false;
  }
}

/** `fetch` that refuses any web address whose origin is not that of `here` (the worker's own address). */
export function sameOriginFetch(inner: typeof fetch, here: string): typeof fetch {
  return (input, init) => {
    const href = input instanceof Request ? input.url : String(input);
    let url: URL;
    try {
      url = new URL(href, here);
    } catch {
      // Not an address at all: fetch itself refuses it.
      return inner(input, init);
    }
    if (!ownFile(url.href, here)) {
      return Promise.reject(new TypeError(`The speech worker reads only the app's own files, not ${url.origin}.`));
    }
    return inner(input, init);
  };
}

interface Scope { WorkerGlobalScope?: abstract new () => unknown; fetch: typeof fetch; location: { href: string } }
const scope = globalThis as unknown as Scope;
// Only inside a worker: the page has its own policy, and a test that imports this is left as it is.
if (typeof scope.WorkerGlobalScope === "function" && globalThis instanceof scope.WorkerGlobalScope) {
  scope.fetch = sameOriginFetch(scope.fetch.bind(globalThis), scope.location.href);
}
