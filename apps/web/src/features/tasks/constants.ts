import { useSyncExternalStore } from 'react';

/**
 * Width of one indentation step, in pixels. The drag maths converts pointer
 * travel into levels with it and the stylesheet draws the rails at the same
 * spacing, so the list hands it to CSS as a custom property rather than letting
 * the two keep separate copies that can drift.
 */
export const INDENT = 26;
export const COMPACT_INDENT = 18;

const COMPACT_QUERY = '(max-width: 560px)';

export function useIndent(): number {
  const compact = useSyncExternalStore(subscribe, isCompact, () => false);
  return compact ? COMPACT_INDENT : INDENT;
}

function isCompact(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
