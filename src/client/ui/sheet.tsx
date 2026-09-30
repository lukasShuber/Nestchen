// Dialogs: a sheet (bottom sheet on phones, centred card on larger screens) and confirm().
// Deliberately a plain fixed overlay instead of the native <dialog> element: the dialog's
// "top layer" has had rendering bugs on iPhones (backdrop shown, sheet invisible).
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../lib/i18n";
import { Button, IconButton, cls } from "./base";

/** Open sheets, innermost last – only the top one reacts to Escape / Tab. */
const stack: number[] = [];
let nextId = 1;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ComponentChildren; children: ComponentChildren; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  // Layout effect: focus moves into the sheet before it's painted, so typing into a field right
  // away can't lose its focus to the sheet a moment later.
  useLayoutEffect(() => {
    if (!open) return;
    const id = nextId++;
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    document.documentElement.classList.add("sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !panel.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") trapFocus(e, panel.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) document.documentElement.classList.remove("sheet-open");
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="sheet-layer">
      <div class="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class={cls("sheet", wide && "sheet-wide")} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div class="sheet-inner">
          <header class="sheet-head">
            <h2 class="sheet-title" id={titleId}>
              {title}
            </h2>
            <IconButton icon="x" label={t("common.close")} onClick={onClose} />
          </header>
          <div class="sheet-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Sticky row of buttons at the bottom of a sheet. */
export function SheetActions({ children }: { children: ComponentChildren }) {
  return <div class="sheet-actions">{children}</div>;
}

interface ConfirmRequest {
  text: string;
  ok?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

let request: ((r: ConfirmRequest) => void) | null = null;

export function confirmDialog(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!request) return resolve(window.confirm(text));
    request({ text, ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<ConfirmRequest | null>(null);
  useEffect(() => {
    request = setCurrent;
    return () => {
      request = null;
    };
  }, []);
  const done = (v: boolean) => {
    current?.resolve(v);
    setCurrent(null);
  };
  return (
    <Sheet open={!!current} onClose={() => done(false)} title={current?.text ?? ""}>
      <SheetActions>
        <Button variant="secondary" onClick={() => done(false)}>
          {t("common.cancel")}
        </Button>
        <Button variant={current?.danger ? "danger" : "primary"} onClick={() => done(true)}>
          {current?.ok ?? (current?.danger ? t("common.delete") : t("common.yes"))}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
