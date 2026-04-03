import { useEffect } from "react";

export function useOutsideClick(refs, callback) {
  useEffect(() => {
    function handleClickOutside(event) {
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
