// "Leave without saving?" for every way out of a screen: the arrow on screen, the Android back button, the
// swipe back on iPhone, and the browser's Back, reload and close. Before this only the on-screen arrow asked.
import { usePreventRemove } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

export interface LeaveGuard {
  /** True while "Leave without saving?" should be on screen. */
  asking: boolean;
  /** The on-screen arrow: asks when there is something to lose, otherwise leaves through `go`. */
  back: (go: () => void) => void;
  /** "Leave, don't save": carries on with the way out that was stopped. */
  leave: () => void;
  /** Cancel: stay on the screen. */
  stay: () => void;
  /** Call just before moving on after a save, so the save itself is never asked about. */
  release: () => void;
}

export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const [asking, setAsking] = useState(false);
  const [released, setReleased] = useState(false);
  // The way out that was stopped: repeated when the person chooses to leave.
  const stopped = useRef<(() => void) | null>(null);
  const on = dirty && !released;
  const disable = usePreventRemove(on, ({ repeat }) => {
    stopped.current = repeat;
    setAsking(true);
  });

  const release = useCallback(() => {
    setReleased(true);
    disable();
  }, [disable]);

  return {
    asking,
    back: (go) => {
      if (!on) {
        go();
        return;
      }
      stopped.current = go;
      setAsking(true);
    },
    leave: () => {
      const go = stopped.current;
      stopped.current = null;
      setAsking(false);
      release();
      go?.();
    },
    stay: () => {
      stopped.current = null;
      setAsking(false);
    },
    release,
  };
}
