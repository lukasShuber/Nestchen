// Private: who gave what, received ✓, thanked ✓ – for writing thank-you cards.
import { useState } from "preact/hooks";
import type { ThanksEntry } from "../../shared/types";
import { api, errorText } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { t } from "../lib/i18n";
import { Button, Chip, Empty, ErrorBox, Field, Input, Loading, Textarea } from "../ui/base";
import { Sheet, SheetActions } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";

export function ThanksPage() {
  const { refreshBadges } = useFamily();
  const { data, error, reload, setData } = useLoad(() => api<{ entries: ThanksEntry[] }>("/admin/thanks"), []);
  const [adding, setAdding] = useState(false);

  const toggle = async (entry: ThanksEntry, field: "received" | "thanked") => {
    if (!data) return;
    const value = !entry[field];
    setData({ entries: data.entries.map((e) => (e === entry ? { ...e, [field]: value } : e)) });
    try {
      if (entry.type === "claim") await api(`/admin/claims/${entry.id}`, { method: "PATCH", body: { [field]: value } });
      else await api(`/admin/items/${entry.id}`, { method: "PATCH", body: { done: value } });
      refreshBadges();
    } catch (err) {
      toast(errorText(err), "error");
      reload();
    }
  };

  const open = data?.entries.filter((e) => !e.thanked) ?? [];
  const done = data?.entries.filter((e) => e.thanked) ?? [];

  return (
    <Page
      title={t("thanks.title")}
      subtitle={t("thanks.lead")}
      actions={
        <Button icon="plus" onClick={() => setAdding(true)}>
          {t("thanks.add")}
        </Button>
      }
    >
      {error ? (
        <ErrorBox error={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : !data.entries.length ? (
        <div class="card">
          <Empty emoji="🎀" title={t("thanks.empty")} />
        </div>
      ) : (
        <>
          <section class="card">
            <h2 class="card-title">
              💌 {t("thanks.open")} <span class="count">{open.length}</span>
            </h2>
            {open.length ? (
              <div class="stack">
                {open.map((e) => (
                  <ThanksRow key={`${e.type}-${e.id}`} entry={e} onToggle={toggle} />
                ))}
              </div>
            ) : (
              <p class="muted">{t("thanks.allDone")}</p>
            )}
          </section>
          {done.length > 0 && (
            <details class="card">
              <summary class="card-title">
                ✓ {t("thanks.done")} <span class="count count-muted">{done.length}</span>
              </summary>
              <div class="stack">
                {done.map((e) => (
                  <ThanksRow key={`${e.type}-${e.id}`} entry={e} onToggle={toggle} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <GiftSheet open={adding} onClose={() => setAdding(false)} onSaved={() => { reload(); refreshBadges(); }} />
    </Page>
  );
}

function ThanksRow({ entry: e, onToggle }: { entry: ThanksEntry; onToggle: (e: ThanksEntry, f: "received" | "thanked") => void }) {
  return (
    <div class="thanks-row">
      <div class="thanks-main">
        <div class="item-title">
          {e.title}
          {e.quantity > 1 && <span class="qty">×{e.quantity}</span>}
        </div>
        <div class="item-sub">
          {e.person && <span>🎁 {e.person}</span>}
          {e.type === "claim" && <span class="pill">{t("thanks.fromWishlist")}</span>}
        </div>
        {e.message && <div class="muted small">{t("common.quote", { text: e.message })}</div>}
      </div>
      <div class="thanks-actions">
        {e.type === "claim" && (
          <Chip active={e.received} onClick={() => onToggle(e, "received")}>
            📦 {t("claim.received")}
          </Chip>
        )}
        <Chip active={e.thanked} onClick={() => onToggle(e, "thanked")}>
          💌 {t("claim.thanked")}
        </Chip>
      </div>
    </div>
  );
}

function GiftSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t("thanks.add")}>
      {open && <GiftForm onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function GiftForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/thanks/gifts", { body: { title, person, notes } });
      toast(t("common.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="form" onSubmit={submit}>
      <Field label={t("thanks.what")}>
        <Input value={title} onValue={setTitle} required maxLength={200} placeholder={t("thanks.whatPh")} autoFocus />
      </Field>
      <Field label={t("thanks.from")}>
        <Input value={person} onValue={setPerson} maxLength={80} placeholder={t("thanks.fromPh")} />
      </Field>
      <Field label={<>{t("item.notes")} <span class="opt">({t("common.optional")})</span></>}>
        <Textarea value={notes} onValue={setNotes} rows={2} maxLength={1000} />
      </Field>
      {!!error && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        <Button type="submit" block busy={busy} icon="check">
          {t("common.save")}
        </Button>
      </SheetActions>
    </form>
  );
}
