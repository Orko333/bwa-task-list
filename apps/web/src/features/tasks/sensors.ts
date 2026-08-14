import { MouseSensor, TouchSensor } from '@dnd-kit/core';
import type { MouseSensorOptions, TouchSensorOptions } from '@dnd-kit/core';
import type { MouseEvent, TouchEvent } from 'react';

/**
 * Anything inside a row that has its own job when pressed. A drag must not start
 * on one of these, or the buttons on a row would be unusable.
 */
const CONTROLS = 'button, input, textarea, select, a, [role="button"]';

function startsOnAControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROLS) !== null;
}

/**
 * The whole row is the drag handle, so the sensors have to be the ones that know
 * where a press does not mean "pick this up".
 *
 * A mouse press is separated from a click by the distance constraint the list
 * passes in: press and release without moving and the row's buttons behave
 * normally. Touch is separated by time instead, so a swipe still scrolls the
 * page and only a deliberate hold picks a row up.
 */
export class RowMouseSensor extends MouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent: event }: MouseEvent, { onActivation }: MouseSensorOptions) => {
        if (event.button !== 0 || startsOnAControl(event.target)) return false;

        onActivation?.({ event });
        return true;
      },
    },
  ];
}

export class RowTouchSensor extends TouchSensor {
  static override activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent: event }: TouchEvent, { onActivation }: TouchSensorOptions) => {
        if (event.touches.length > 1 || startsOnAControl(event.target)) return false;

        onActivation?.({ event });
        return true;
      },
    },
  ];
}
