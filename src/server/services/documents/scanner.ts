/**
 * Malware scanning adapter.
 *
 * Every upload is passed to the active scanner BEFORE it is written to
 * storage. "infected" rejects the upload; "clean" / "skipped" / "error" are
 * stored on the document row (`scan_status`) so HR can see what happened.
 *
 * The default is NoopScanner, which returns "skipped" (no scanning engine is
 * configured). To plug in ClamAV:
 *
 *   1. Run clamd (e.g. the `clamav/clamav` container) reachable from the app,
 *      typically on TCP 3310.
 *   2. Implement MalwareScanner using clamd's INSTREAM protocol:
 *        - open a TCP socket, write "zINSTREAM\0"
 *        - write the bytes in chunks, each prefixed with a 4-byte big-endian
 *          length; finish with a zero-length chunk (4 zero bytes)
 *        - read the reply: "stream: OK" => "clean",
 *          "stream: <name> FOUND" => "infected", anything else => "error"
 *      Apply a timeout (e.g. 15s) and return "error" on network failures.
 *   3. Call setMalwareScanner(new ClamAvScanner({ host, port })) once at
 *      server start-up (e.g. from instrumentation.ts), guarded by an env var.
 *
 * Decide per deployment whether "error" should block uploads (fail closed);
 * the service currently stores the document and records scan_status "error".
 */
export type ScanResult = "clean" | "infected" | "skipped" | "error";

export interface MalwareScanner {
  scan(bytes: Uint8Array, mime: string): Promise<ScanResult>;
}

export class NoopScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> {
    return "skipped";
  }
}

let active: MalwareScanner = new NoopScanner();

export function setMalwareScanner(scanner: MalwareScanner) {
  active = scanner;
}

export function getMalwareScanner(): MalwareScanner {
  return active;
}
