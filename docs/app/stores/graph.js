/**
 * A small Microsoft Graph client: one function to send a request with the signed-in person's
 * token, waiting and trying again when Graph asks for that, and one to read every page of a
 * list.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(status, code, message) {
    super(message || "Microsoft 365 returned an error (" + status + ").");
    this.status = status;
    this.code = code || "";
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * getToken(scopes) must resolve to an access token for Microsoft Graph.
 * options: { fetch, scopes, maxWaitSeconds }
 */
export function makeGraph(getToken, options) {
  const o = options || {};
  const doFetch = o.fetch || ((...args) => fetch(...args));
  const maxWait = o.maxWaitSeconds === undefined ? 20 : o.maxWaitSeconds;

  async function request(method, path, body, extra) {
    const x = extra || {};
    const url = /^https:\/\//.test(path) ? path : GRAPH + path;
    if (!/^https:\/\/graph\.microsoft\.com\//.test(url)) throw new GraphError(0, "badUrl", "Refusing to send a token to an address that is not Microsoft Graph.");
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(x.scopes || o.scopes);
      const headers = Object.assign({ Authorization: "Bearer " + token, Accept: "application/json" }, x.headers || {});
      if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
      let response;
      try {
        response = await doFetch(url, { method, headers, body: body === undefined || body === null ? undefined : JSON.stringify(body) });
      } catch (e) {
        throw new GraphError(0, "network", "Microsoft 365 could not be reached. Check your connection and try again.");
      }
      // A request that timed out may still have gone through, so only requests that are safe
      // to repeat are retried after a 503 or 504. A 429 was refused outright and is always safe.
      const repeatable = response.status === 429 || ((response.status === 503 || response.status === 504) && method !== "POST");
      if (repeatable && attempt < 3) {
        const asked = Number(response.headers && response.headers.get && response.headers.get("Retry-After"));
        const seconds = Number.isFinite(asked) && asked > 0 ? asked : 2 * (attempt + 1);
        if (seconds <= maxWait) {
          await wait(seconds * 1000);
          continue;
        }
      }
      if (response.status === 204) return null;
      let data = null;
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = null;
        }
      }
      if (response.ok) return data;
      const err = (data && data.error) || {};
      throw new GraphError(response.status, err.code, friendly(response.status, err.code, err.message));
    }
  }

  /** Every item of a paged collection, following @odata.nextLink. Stops after maxPages. */
  async function all(path, extra, maxPages) {
    const out = [];
    let next = path;
    for (let page = 0; next && page < (maxPages || 40); page++) {
      const data = await request("GET", next, null, extra);
      out.push(...((data && data.value) || []));
      next = data && data["@odata.nextLink"];
    }
    return out;
  }

  return {
    get: (path, extra) => request("GET", path, null, extra),
    post: (path, body, extra) => request("POST", path, body, extra),
    patch: (path, body, extra) => request("PATCH", path, body, extra),
    all,
  };
}

function friendly(status, code, message) {
  if (status === 401) return "Your Microsoft 365 sign-in has expired. Sign in again.";
  if (status === 403) return "Microsoft 365 did not allow that. Your account or this add-in may not have permission yet. (" + (message || code || "403") + ")";
  if (status === 404) return "Microsoft 365 could not find that. (" + (message || code || "404") + ")";
  if (status === 412) return "Someone else changed this a moment ago.";
  if (status === 429) return "Microsoft 365 is busy. Please try again in a minute.";
  return (message || "Microsoft 365 returned an error.") + " (" + status + ")";
}
