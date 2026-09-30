// Small toast notifications. The container is a "popover" so it also shows on top of open dialogs.
import { useEffect, useRef, useState } from "preact/hooks";

interface ToastItem {
  id: number;
  message: string;
  kind: "ok" | "error";
}

let push: ((item: ToastItem) => void) | null = null;
let nextId = 1;

export function toast(message: string, kind: "ok" | "error" = "ok") {
  push?.({ id: nextId++, message, kind });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    push = (item) => {
      setItems((list) => [...list.slice(-2), item]);
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), item.kind === "error" ? 5000 : 2800);
    };
    return () => {
      push = null;
    };
  }, []);
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      // Re-showing moves the popover to the top of the stack (above any open dialog).
      if (el.matches(":popover-open")) el.hidePopover!();
      if (items.length) el.showPopover();
    } catch {
      /* popover not supported */
    }
  }, [items]);
  return (
    <div ref={ref} class="toasts" popover="manual" role="status" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} class={`toast toast-${i.kind}`}>
          {i.message}
        </div>
      ))}
    </div>
  );
}
