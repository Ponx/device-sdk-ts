import { LoggerPublisherService } from "@ledgerhq/device-management-kit";
import { inject, injectable } from "inversify";

import { TYPES } from "@root/src/di/types";
import { type DeviceController } from "@root/src/domain/adapters/DeviceController";
import { type ScreenshotSaver } from "@root/src/domain/adapters/ScreenshotSaver";
import { type SignableInput } from "@root/src/domain/models/SignableInput";
import { type RetryService } from "@root/src/domain/services/RetryService";
import { type ScreenAnalyzerService } from "@root/src/domain/services/ScreenAnalyzer";

import { type StateHandler, type StateHandlerResult } from "./StateHandler";

// Budget to wait for the Web3 Checks modal to actually render before tapping
// its hardcoded coordinate. The device can still be showing a prior screen
// (e.g. the app's launch/info screen, with its "Quit app" gesture zone) for a
// moment after the triggering APDU is sent — tapping blind into that screen
// risks hitting an unintended element instead of the modal.
const WEB3_CHECKS_MODAL_MAX_ATTEMPTS = 6;
const WEB3_CHECKS_MODAL_POLL_DELAY_MS = 1000;

// Extra settle delay after the modal's text is first detected, before
// actually tapping it. Confirmed via curl reproduction against a Speculinho
// pod directly: the modal's text can be readable via the screen-content API
// slightly before the Speculos automation layer is actually ready to accept
// touch input on it. A tap fired in that window is silently dropped — the
// app never advances past the modal — which was being misdiagnosed as a
// ~15s network/connection timeout on the underlying blocking APDU. In
// reality the connection dies because nothing ever happened on the device,
// not because of a fixed external timeout. Waiting a bit after the modal is
// confirmed visible lets the touch actually land.
const WEB3_CHECKS_MODAL_SETTLE_DELAY_MS = 1500;

@injectable()
export class OptOutStateHandler implements StateHandler {
  private readonly logger: LoggerPublisherService;

  constructor(
    @inject(TYPES.LoggerPublisherServiceFactory)
    private readonly loggerFactory: (tag: string) => LoggerPublisherService,
    @inject(TYPES.DeviceController)
    private readonly deviceController: DeviceController,
    @inject(TYPES.ScreenshotSaver)
    private readonly screenshotSaver: ScreenshotSaver,
    @inject(TYPES.ScreenAnalyzerService)
    private readonly screenAnalyzer: ScreenAnalyzerService,
    @inject(TYPES.RetryService)
    private readonly retryService: RetryService,
  ) {
    this.logger = this.loggerFactory("opt-out-state-handler");
  }

  async handle(ctx: { input: SignableInput }): Promise<StateHandlerResult> {
    this.logger.debug("Opt out state handler", {
      data: { ctx },
    });

    await this.screenshotSaver.save();

    try {
      await this.retryService.pollUntil(
        async () => await this.screenAnalyzer.isWeb3ChecksOptInScreen(),
        WEB3_CHECKS_MODAL_MAX_ATTEMPTS,
        WEB3_CHECKS_MODAL_POLL_DELAY_MS,
      );
    } catch (_error) {
      this.logger.warn(
        "Web3 Checks opt-in modal did not render in time — skipping tap to avoid hitting an unintended screen element.",
      );
      return {
        status: "ongoing",
      };
    }

    await this.delay(WEB3_CHECKS_MODAL_SETTLE_DELAY_MS);

    // Capture the exact frame about to be tapped — separate from the
    // handler-entry screenshot above, which can predate the modal actually
    // rendering. This is our ground truth for "what did we really tap".
    const preTapScreenshotPath = await this.screenshotSaver.save();
    this.logger.info("Screenshot before tapping opt-out modal", {
      data: { screenshotPath: preTapScreenshotPath },
    });

    await this.deviceController.rejectTransactionCheck();

    return {
      status: "ongoing",
    };
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
