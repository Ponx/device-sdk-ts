import { type SpeculinhoConfig } from "@root/src/domain/models/config/SpeculinhoConfig";

/**
 * Returns the Speculos emulator base URL for API calls.
 * Written at runtime by SpeculinhoServiceController once its `start()` completes.
 */
export function getEmulatorBaseUrl(config: SpeculinhoConfig): string {
  if (!config.resolvedUrl) {
    throw new Error(
      "Emulator URL not yet resolved – did SpeculinhoServiceController.start() run?",
    );
  }
  return config.resolvedUrl;
}
