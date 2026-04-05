import { useEffect, RefObject } from "react";

export function useOutsideClick(refs: RefObject<any>[], callback: () => void): void {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!refs.some(ref => ref.current && ref.current.contains(event.target))) {
        callback();
      }
    }
    // Bind the event listener
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener("mousedown", handleClickOutside);
    };
  },[refs]);
}
