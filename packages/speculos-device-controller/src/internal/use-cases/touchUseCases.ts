import type { PercentCoordinates } from "@internal/core/types";
import { type TouchController } from "@root/src/internal/core/TouchController";

const TAP_LONG_TIME_MS = 5000;

export const tapLong =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async (point: PercentCoordinates, delayMs: number = TAP_LONG_TIME_MS) => {
    await touch.tap(deviceKey, point);
    await new Promise((r) => setTimeout(r, delayMs));
    await touch.release(deviceKey, point);
  };

export const tapQuick =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async (point: PercentCoordinates) =>
    await touch.tapAndRelease(deviceKey, point);

export const sign =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async (delayMs: number = TAP_LONG_TIME_MS) =>
    await tapLong(touch, deviceKey)({ x: 85, y: 80 }, delayMs);

export const reject =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 20, y: 90 });

export const navigateNext =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 90, y: 90 });

export const navigatePrevious =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 45, y: 90 });

export const mainButton =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 50, y: 80 });

export const secondaryButton =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 50, y: 90 });

export const enterMenu =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 85, y: 8 });

export const exitMenu =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 10, y: 4 });

const BLIND_SIGNING_TOGGLE_COORDS = {
  stax: { x: 88, y: 51 },
  flex: { x: 88, y: 58 },
  apex: { x: 88, y: 58 },
} as const satisfies Record<string, PercentCoordinates>;

type BlindSigningTouchKey = keyof typeof BLIND_SIGNING_TOGGLE_COORDS;

const isBlindSigningTouchKey = (key: string): key is BlindSigningTouchKey =>
  Object.hasOwn(BLIND_SIGNING_TOGGLE_COORDS, key);

const DEFAULT_BLIND_SIGNING_TOGGLE_COORDS: PercentCoordinates = {
  x: 88,
  y: 51,
};

export const enableBlindSigningSettings =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () => {
    const point = isBlindSigningTouchKey(deviceKey)
      ? BLIND_SIGNING_TOGGLE_COORDS[deviceKey]
      : DEFAULT_BLIND_SIGNING_TOGGLE_COORDS;
    await tapQuick(touch, deviceKey)(point);
  };

export const continueToBlindSigning =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 50, y: 94 });

export const acceptBlindSigning =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () =>
    await tapQuick(touch, deviceKey)({ x: 50, y: 94 });

// Confirmed via `initiate-sign` + `GET /events` against a live Stax pod: the
// "Maybe later" button's text spans x=130-482px, y=612-644px on a 400x672
// screen, i.e. centered around (76.5%, 93.5%). The previously-used
// `secondaryButton()` coordinate `{x: 50, y: 90}` lands just above that
// button, in the screen's "Quit app" swipe-gesture zone (confirmed present
// at (49.9%, 93.1%) on the same screen) — tapping there exits the app
// instead of answering the modal. Only Stax has a confirmed coordinate so
// far; other devices fall back to the same value pending verification.
const WEB3_CHECKS_OPT_OUT_COORDS = {
  stax: { x: 77, y: 94 },
} as const satisfies Record<string, PercentCoordinates>;

type Web3ChecksOptOutTouchKey = keyof typeof WEB3_CHECKS_OPT_OUT_COORDS;

const isWeb3ChecksOptOutTouchKey = (
  key: string,
): key is Web3ChecksOptOutTouchKey =>
  Object.hasOwn(WEB3_CHECKS_OPT_OUT_COORDS, key);

const DEFAULT_WEB3_CHECKS_OPT_OUT_COORDS: PercentCoordinates = {
  x: 77,
  y: 94,
};

export const rejectWeb3ChecksOptIn =
  <K extends string>(touch: TouchController<K>, deviceKey: K) =>
  async () => {
    const point = isWeb3ChecksOptOutTouchKey(deviceKey)
      ? WEB3_CHECKS_OPT_OUT_COORDS[deviceKey]
      : DEFAULT_WEB3_CHECKS_OPT_OUT_COORDS;
    await tapQuick(touch, deviceKey)(point);
  };
