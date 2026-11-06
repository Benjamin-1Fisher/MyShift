/** Compare the browser origin with the externally addressed Host, because Next's
 * request URL may contain an internal hostname behind a hosting proxy. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || new URL(req.url).host;
  let valid = false;
  try {
    const parsed = new URL(origin || "");
    valid =
      ["http:", "https:"].includes(parsed.protocol) && parsed.host === host;
  } catch {}
  if (!valid || req.headers.get("sec-fetch-site") === "cross-site") {
    const error = new Error("Invalid origin");
    error.name = "OriginError";
    throw error;
  }
}
