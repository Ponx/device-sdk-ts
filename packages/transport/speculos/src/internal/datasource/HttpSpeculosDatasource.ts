// Type-only imports — completely erased at compile time, never bundled by Webpack.
// ClientRequest / IncomingMessage live in node:http even for HTTPS connections.
import type { ClientRequest, IncomingMessage } from "node:http";
import type { Agent as HttpsAgent } from "node:https";

import {
  DmkNetworkClient,
  DmkNetworkClientError,
} from "@ledgerhq/device-management-kit";

import PACKAGE from "@root/package.json";

import { type SpeculosDatasource } from "./SpeculosDatasource";

const TIMEOUT = 10_000; // 10 second timeout — generous enough for remote Speculinho pods

const removeTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

/** True only in a real Node.js process — never in a browser bundle. */
const IS_NODE =
  typeof process !== "undefined" && typeof process.versions?.node === "string";

export class HttpSpeculosDatasource implements SpeculosDatasource {
  private readonly baseUrl: string;
  private readonly clientHeader: string;
  private readonly http: DmkNetworkClient;

  constructor(
    baseUrl: string,
    clientHeader: string = `ldmk-transport-speculos/${PACKAGE.version}`,
  ) {
    this.baseUrl = removeTrailingSlashes(baseUrl);
    this.clientHeader = clientHeader;
    this.http = new DmkNetworkClient({
      headers: {
        "X-Ledger-Client-Version": this.clientHeader,
      },
    });
  }

  /**
   * Send an APDU to Speculos.
   *
   * For Node.js + HTTPS (i.e. Speculinho), the native `node:https` module is
   * used so the blocking APDU gets its own TCP connection, completely isolated
   * from the undici pool shared by touch (/finger) and screen (/events)
   * requests. Without this isolation Envoy's ~15 s route timeout resets the
   * shared connection mid-review, killing concurrent requests and stalling the
   * signing flow.
   *
   * For plain HTTP (local Speculos) or browser environments the Envoy problem
   * does not apply, so DmkNetworkClient (globalThis.fetch) is used instead.
   */
  postApdu(apdu: string): Promise<string> {
    if (IS_NODE && this.baseUrl.startsWith("https:")) {
      return this._postApduNodeHttps(apdu);
    }
    return this._postApduFetch(apdu);
  }

  /** HTTP / browser fallback: send via DmkNetworkClient (globalThis.fetch). */
  private _postApduFetch(apdu: string): Promise<string> {
    return this.http
      .post(`${this.baseUrl}/apdu`, { data: apdu })
      .then((response) => {
        const data = response as { data?: string; error?: string };
        if (!data?.data) {
          throw new DmkNetworkClientError({
            message: `Speculos /apdu returned no data field: ${
              data?.error ?? JSON.stringify(response) ?? "empty body"
            }`,
          });
        }
        return data.data;
      });
  }

  /**
   * Node.js + HTTPS path: dynamically import `node:https` so that Webpack
   * (used by the sample app's Next.js build) never attempts to bundle it.
   * The `webpackIgnore: true` hint tells Webpack to skip static analysis of
   * this import; the IS_NODE + https guard in postApdu() ensures this method
   * is never called in a browser context or against an HTTP URL.
   *
   * The `any` cast on the module is intentional: Webpack skips type resolution
   * for ignored imports, so no static module type is available. The named types
   * at the top of the file (HttpsAgent, ClientRequest, IncomingMessage) cover
   * specific local variables.
   */
  private async _postApduNodeHttps(apdu: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpsMod: any = await import(/* webpackIgnore: true */ "node:https");

    /* eslint-disable
       @typescript-eslint/no-unsafe-assignment,
       @typescript-eslint/no-unsafe-call,
       @typescript-eslint/no-unsafe-member-access
    */
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseUrl}/apdu`);
      // keepAlive:false → each APDU call gets its own fresh TCP connection.
      const agent = new httpsMod.Agent({ keepAlive: false }) as HttpsAgent;
      const body = JSON.stringify({ data: apdu });

      const req: ClientRequest = httpsMod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "X-Ledger-Client-Version": this.clientHeader,
          },
          agent,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: { data?: string; error?: string };
            try {
              parsed = JSON.parse(raw) as { data?: string; error?: string };
            } catch {
              reject(
                new DmkNetworkClientError({
                  message: `Speculos /apdu: invalid JSON response: ${raw}`,
                }),
              );
              return;
            }
            if (!parsed.data) {
              // Treat Speculos error responses as connectivity failures so the
              // transport layer can disconnect and trigger a reconnect.
              reject(
                new DmkNetworkClientError({
                  message: `Speculos /apdu returned no data field: ${parsed.error ?? raw}`,
                }),
              );
            } else {
              resolve(parsed.data);
            }
          });
          res.on("error", (err: Error) => {
            reject(new DmkNetworkClientError({ message: err.message }));
          });
        },
      );

      req.on("error", (err: Error) => {
        reject(new DmkNetworkClientError({ message: err.message }));
      });

      req.write(body);
      req.end();
    });
    /* eslint-enable
       @typescript-eslint/no-unsafe-assignment,
       @typescript-eslint/no-unsafe-call,
       @typescript-eslint/no-unsafe-member-access
    */
  }

  async isServerAvailable(): Promise<boolean> {
    try {
      await this.http.get(`${this.baseUrl}/events`, {
        timeoutMs: TIMEOUT,
        responseType: "void",
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * open an SSE event stream using the fetch API.
   * - calls `onEvent` for each line starting with "data: "
   * - calls `onClose` when the stream ends or errors
   * - returns the ReadableStream so callers can `cancel()` it
   */
  async openEventStream(
    onEvent: (json: Record<string, unknown>) => void,
    onClose?: () => void,
  ): Promise<ReadableStream<Uint8Array>> {
    if (typeof fetch === "undefined") {
      throw new Error("global fetch is not available in Node < 18");
    }

    const url = `${this.baseUrl}/events?stream=true`;

    const controller = new AbortController();

    const headers: HeadersInit = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Ledger-Client-Version": this.clientHeader,
    };

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      controller.abort();
      throw new Error(`SSE request failed with status ${response.status}`);
    }

    const stream = response.body;
    if (!stream) {
      controller.abort();
      throw new Error("SSE response has no body stream.");
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let closed = false;

    const finalize = () => {
      if (!closed) {
        closed = true;
        try {
          onClose?.();
        } catch {
          // swallow listener errors
        }
      }
    };

    const emitParsedEvent = (line: string) => {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6);
        try {
          onEvent(JSON.parse(payload));
        } catch {
          onEvent({ data: payload });
        }
      }
    };

    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // normalise line breaks and process complete lines
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? ""; // keep last partial line

          for (const line of lines) {
            emitParsedEvent(line);
            // other SSE fields ignored to mirror original behavior
          }
        }
      } catch {
        // network/reader error
      } finally {
        // flush any remaining buffered text as lines
        if (buffer.length) {
          for (const line of buffer.split(/\r?\n/)) {
            emitParsedEvent(line);
          }
          buffer = "";
        }
        finalize();
      }
    })();

    // consumers can cancel with: (await openEventStream(...)).cancel()
    return stream;
  }
}
