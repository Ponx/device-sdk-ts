import * as http from "node:http";
import * as https from "node:https";

import {
  DmkNetworkClient,
  DmkNetworkClientError,
} from "@ledgerhq/device-management-kit";

import PACKAGE from "@root/package.json";

import { type SpeculosDatasource } from "./SpeculosDatasource";

const TIMEOUT = 10_000; // 10 second timeout — generous enough for remote Speculinho pods

const removeTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

// Dedicated HTTP/1.1 agents for APDU calls. Using Node's native http/https
// module (not undici / globalThis.fetch) gives the blocking APDU a completely
// separate TCP connection pool from the one shared by touch (/finger) and
// screen (/events) requests. Without this isolation all three compete over the
// same undici HTTP/2 multiplexed connection: Envoy resets the entire connection
// when the long-lived APDU stream exceeds its route timeout (~15 s), which
// simultaneously kills the in-flight touch and screen reads, stalls the review,
// and ultimately triggers a session teardown. With keepAlive:false each APDU
// call gets its own fresh TCP connection so there is zero sharing.
const apduHttpAgent = new http.Agent({ keepAlive: false });
const apduHttpsAgent = new https.Agent({ keepAlive: false });

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
   * Send an APDU to Speculos via Node's native http/https module, bypassing
   * the globalThis.fetch (undici) connection pool that is shared with touch
   * and screen requests. See the module-level comment on apduHttpsAgent.
   */
  postApdu(apdu: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseUrl}/apdu`);
      const isHttps = parsedUrl.protocol === "https:";
      const agent = isHttps ? apduHttpsAgent : apduHttpAgent;
      const lib = isHttps ? https : http;
      const body = JSON.stringify({ data: apdu });

      const req = lib.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "X-Ledger-Client-Version": this.clientHeader,
          },
          agent,
        },
        (res) => {
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
