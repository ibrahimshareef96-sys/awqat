/**
 * The speech worker's own fence. The page's Content-Security-Policy does not reach a worker started from one of the
 * app's files (the worker has no policy of its own), so this stands in for its connect-src: a fetch to a web address
 * of another site is refused before it goes. transformers.js defaults to Hugging Face and ONNX Runtime to a CDN;
 * worker.ts turns both off, and this keeps a later default from reaching the network anyway. It is the worker's first
 * import, so it is in place before either library runs.
 */

/** The schemes that reach the network. Anything else (the app's own scheme on iOS, blob:, data:) stays on the phone. */
const WEB = new Set(["http:", "https:", "ws:", "wss:"]);

/** `fetch` that refuses any web address whose origin is not that of `here` (the worker's own address). */
export function sameOriginFetch(inner: typeof fetch, here: string): typeof fetch {
  const own = new URL(here).origin;
  return (input, init) => {
    const href = input instanceof Request ? input.url : String(input);
    let url: URL;
    try {
      url = new URL(href, here);
    } catch {
      // Not an address at all: fetch itself refuses it.
      return inner(input, init);
    }
    if (WEB.has(url.protocol) && url.origin !== own) {
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
