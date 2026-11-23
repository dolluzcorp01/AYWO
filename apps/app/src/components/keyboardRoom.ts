// Keeps the button under a box in reach while the keyboard is up.
//
// When a box is tapped, the phone scrolls just far enough to show the box itself. The button that belongs to it
// (Post under a comment, Save under a number) stayed hidden behind the keyboard, and a tap where it should have been
// only closed the keyboard. So after the keyboard opens, the page scrolls a little further: far enough for one
// button under the box.
import { useEffect, useRef } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Keyboard, Platform, ScrollView, TextInput } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Room for one small button and its gap under the box being typed in. */
const ROOM_UNDER_BOX = 104;

export function useButtonInReach(scroller: RefObject<ComponentRef<typeof ScrollView> | null>) {
  const offset = useRef(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = Keyboard.addListener('keyboardDidShow', (e) => {
      const box = TextInput.State.currentlyFocusedInput();
      if (!box) return;
      // A moment for the page to settle into the space the keyboard left.
      timer = setTimeout(() => {
        box.measureInWindow((_x, y, _w, h) => {
          const hidden = y + h + ROOM_UNDER_BOX - e.endCoordinates.screenY;
          if (hidden > 0) scroller.current?.scrollTo({ y: offset.current + hidden, animated: true });
        });
      }, 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      watch.remove();
    };
  }, [scroller]);
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  };
}
