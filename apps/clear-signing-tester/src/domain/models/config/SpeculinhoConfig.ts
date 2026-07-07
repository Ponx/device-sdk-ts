/**
 * Domain model representing the Speculinho configuration
 */
export type SpeculinhoConfig = {
  device: "stax" | "nanox" | "nanos" | "nanos+" | "flex" | "apex";
  /** Ledger app to load (e.g. "Ethereum", "Solana"). Defaults to "Ethereum" */
  appName?: string;
  /** App version to request (e.g. "1.19.1"). Passed to Speculinho as `coin_app_version`. */
  appVersion?: string;
  /** OS version to request (e.g. "1.4.0"). Passed to Speculinho as `device_os_version`. */
  osVersion?: string;
  screenshotPath?: string;
  /**
   * Speculinho operator base URL override. Resolved at runtime by
   * SpeculinhoServiceController (falls back to SPECULINHO_URL env var,
   * then "https://speculinho.ledgerlabs.net").
   */
  speculinhoUrl?: string;
  /**
   * The Speculos emulator base URL, written at runtime by
   * SpeculinhoServiceController once the pod is ready.
   * Use `getEmulatorBaseUrl` from `domain/utils/getEmulatorBaseUrl` rather
   * than reading this field directly.
   */
  resolvedUrl?: string;
};
