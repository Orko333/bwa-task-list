/**
 * The modifier the reorder shortcuts use, spelled the way the keyboard in front
 * of the user spells it. Apple keyboards have no key labelled Alt; the one that
 * raises `event.altKey` is Option, printed as ⌥.
 */
export const ALT_KEY_LABEL = isApplePlatform() ? '⌥' : 'Alt';

/** Same key, written out for a screen reader rather than shown on a keycap. */
export const ALT_KEY_NAME = isApplePlatform() ? 'Option' : 'Alt';

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
