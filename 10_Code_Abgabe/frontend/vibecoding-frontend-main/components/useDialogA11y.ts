import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal-dialog accessibility behavior: Escape/backdrop close (both
 * suppressed while `disabled`, e.g. saving), a focus trap inside the dialog,
 * and returning focus to whatever triggered the dialog once it unmounts.
 * Initial focus on a specific field stays the caller's responsibility (each
 * dialog knows which field makes sense to focus first).
 */
export function useDialogA11y({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (disabled) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, disabled]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.target === event.currentTarget) onClose();
  }

  return { containerRef, handleBackdropClick };
}
