// Dialogs: a sheet (bottom sheet on phones, centred card on larger screens) and confirm().
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../lib/i18n";
import { Button, IconButton, cls } from "./base";

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ComponentChildren; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      autoFocus
      class={cls("sheet", wide && "sheet-wide")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => (pressedOnBackdrop.current = e.target === ref.current)}
      onClick={(e) => {
        if (e.target === ref.current && pressedOnBackdrop.current) onClose();
      }}
    >
      {open && (
        <div class="sheet-inner">
          <header class="sheet-head">
            <h2 class="sheet-title">{title}</h2>
            <IconButton icon="x" label={t("common.close")} onClick={onClose} />
          </header>
          <div class="sheet-body">{children}</div>
        </div>
      )}
    </dialog>
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
        <Button variant={current?.danger ? "danger" : "primary"} onClick={() => done(true)} autoFocus>
          {current?.ok ?? (current?.danger ? t("common.delete") : t("common.yes"))}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
