// People not to forget (visits page): who should meet the baby. Invite them with a prepared message
// (WhatsApp, SMS, e-mail or copy) and tick them off once they've visited.
import { useState } from "preact/hooks";
import { PERSON_STATUSES } from "../../shared/types";
import type { Person, PersonStatus } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { t } from "../lib/i18n";
import { copyText, emailOf, mailtoUrl, phoneDigits, smsUrl, whatsappUrl } from "../lib/links";
import { Button, Check, Empty, ErrorBox, Field, Input, LinkButton, Loading, Segmented, Textarea, cls } from "../ui/base";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { useFamily } from "./context";

export function PeopleList({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload, setData } = useLoad(() => api<{ people: Person[] }>("/admin/people"), []);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [inviting, setInviting] = useState<Person | null>(null);

  const people = data?.people ?? [];
  const replace = (p: Person) => setData({ people: people.map((x) => (x.id === p.id ? p : x)) });

  const setStatus = async (p: Person, status: PersonStatus) => {
    replace({ ...p, status });
    try {
      const r = await api<{ person: Person }>(`/admin/people/${p.id}`, { method: "PATCH", body: { status } });
      replace(r.person);
      onChanged();
    } catch (err) {
      toast(errorText(err), "error");
      reload();
    }
  };

  const add = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await api<{ person: Person }>("/admin/people", { body: { name } });
      setData({ people: [...people, r.person] });
      setName("");
      onChanged();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setAdding(false);
    }
  };

  if (error && !data) return <ErrorBox error={errorText(error)} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <p class="field-hint">{t("people.hint")}</p>
      <form class="quick-add" onSubmit={add}>
        <Input value={name} onValue={setName} placeholder={t("people.addPh")} aria-label={t("people.addPh")} maxLength={80} />
        <Button type="submit" icon="plus" busy={adding}>
          {t("common.add")}
        </Button>
      </form>
      {!people.length ? (
        <div class="card">
          <Empty emoji="💌" title={t("people.empty")} />
        </div>
      ) : (
        PERSON_STATUSES.map((status) => {
          const list = people.filter((p) => p.status === status);
          return list.length ? (
            <section class={cls("card", status === "visited" && "is-quiet")} key={status}>
              <h2 class="card-title">
                {t(`people.group.${status}`)} <span class="count">{list.length}</span>
              </h2>
              <ul class="people">
                {list.map((p) => (
                  <PersonRow key={p.id} person={p} onStatus={(s) => setStatus(p, s)} onEdit={() => setEditing(p)} onInvite={() => setInviting(p)} />
                ))}
              </ul>
            </section>
          ) : null;
        })
      )}
      <PersonSheet
        person={editing}
        onClose={() => setEditing(null)}
        onSaved={(p) => {
          replace(p);
          onChanged();
        }}
        onDeleted={(id) => {
          setData({ people: people.filter((x) => x.id !== id) });
          onChanged();
        }}
      />
      <InviteSheet person={inviting} onClose={() => setInviting(null)} onSent={(p) => p.status === "open" && setStatus(p, "invited")} />
    </>
  );
}

function PersonRow({ person: p, onStatus, onEdit, onInvite }: { person: Person; onStatus: (s: PersonStatus) => void; onEdit: () => void; onInvite: () => void }) {
  const visited = p.status === "visited";
  return (
    <li class={cls("person", visited && "is-done")}>
      <Check checked={visited} onChange={(v) => onStatus(v ? "visited" : "open")} label={t("people.visitedFor", { name: p.name })} />
      <button type="button" class="person-main" onClick={onEdit}>
        <span class="person-name">{p.name}</span>
        {(p.note || p.contact) && <span class="person-sub">{[p.note, p.contact].filter(Boolean).join(" · ")}</span>}
      </button>
      {p.status === "open" && (
        <Button size="sm" variant="soft" icon="send" onClick={onInvite}>
          {t("people.invite")}
        </Button>
      )}
      {p.status === "invited" && (
        <button type="button" class="pill person-invited" onClick={onInvite} title={t("people.inviteAgain")}>
          {t("people.status.invited")}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- edit

function PersonSheet({
  person,
  onClose,
  onSaved,
  onDeleted,
}: {
  person: Person | null;
  onClose: () => void;
  onSaved: (p: Person) => void;
  onDeleted: (id: number) => void;
}) {
  return (
    <Sheet open={!!person} onClose={onClose} title={person?.name ?? ""}>
      {person && <PersonForm key={person.id} person={person} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />}
    </Sheet>
  );
}

function PersonForm({ person, onClose, onSaved, onDeleted }: { person: Person; onClose: () => void; onSaved: (p: Person) => void; onDeleted: (id: number) => void }) {
  const [name, setName] = useState(person.name);
  const [contact, setContact] = useState(person.contact);
  const [note, setNote] = useState(person.note);
  const [status, setStatus] = useState<PersonStatus>(person.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ person: Person }>(`/admin/people/${person.id}`, { method: "PATCH", body: { name, contact, note, status } });
      toast(t("common.saved"));
      onSaved(r.person);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog(t("people.deleteConfirm", { name: person.name }), { danger: true }))) return;
    try {
      await api(`/admin/people/${person.id}`, { method: "DELETE" });
      toast(t("common.deleted"));
      onDeleted(person.id);
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const fieldError = (field: string) => (error?.field === field ? errorText(error) : null);
  return (
    <form class="form" onSubmit={save}>
      <Field label={t("people.name")} error={fieldError("name")}>
        <Input value={name} onValue={setName} required maxLength={80} />
      </Field>
      <Field label={t("people.contact")} hint={t("people.contactHint")} error={fieldError("contact")}>
        <Input value={contact} onValue={setContact} maxLength={120} placeholder={t("people.contactPh")} autoComplete="off" />
      </Field>
      <Field label={t("people.note")} error={fieldError("note")}>
        <Textarea value={note} onValue={setNote} rows={2} maxLength={500} placeholder={t("people.notePh")} />
      </Field>
      <Field group label={t("people.status")}>
        <Segmented value={status} onChange={setStatus} label={t("people.status")} options={PERSON_STATUSES.map((s) => ({ value: s, label: t(`people.status.${s}`) }))} />
      </Field>
      {error && !error.field && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        <Button variant="danger" icon="trash" onClick={remove}>
          {t("common.delete")}
        </Button>
        <span class="spacer" />
        <Button type="submit" busy={busy} icon="check">
          {t("common.save")}
        </Button>
      </SheetActions>
    </form>
  );
}

// ---------------------------------------------------------------- invite

function InviteSheet({ person, onClose, onSent }: { person: Person | null; onClose: () => void; onSent: (p: Person) => void }) {
  return (
    <Sheet open={!!person} onClose={onClose} title={t("people.inviteTitle", { name: person?.name ?? "" })}>
      {person && <InviteForm key={person.id} person={person} onSent={() => onSent(person)} />}
    </Sheet>
  );
}

/** A ready-made invitation with the link to the public page (incl. the family code, if there is one). */
function InviteForm({ person, onSent }: { person: Person; onSent: () => void }) {
  const { settings } = useFamily();
  const link = `${location.origin}/${settings.guestCode ? `#code=${encodeURIComponent(settings.guestCode)}` : ""}`;
  const [text, setText] = useState(() => t("people.inviteText", { name: person.name, link }));
  const phone = phoneDigits(person.contact, settings.phoneCc);
  const email = emailOf(person.contact);
  return (
    <div class="notify">
      <p class="field-hint">{t("people.inviteHint")}</p>
      <Textarea value={text} onValue={setText} rows={6} aria-label={t("people.inviteTitle", { name: person.name })} />
      <div class="row wrap">
        <LinkButton size="sm" variant="primary" class="btn-whatsapp" href={whatsappUrl(phone ?? "", text)} external icon="chat" onClick={onSent}>
          {t("visits.whatsapp")}
        </LinkButton>
        {phone && (
          <LinkButton size="sm" href={smsUrl(phone, text)} icon="phone" onClick={onSent}>
            {t("visits.sms")}
          </LinkButton>
        )}
        {email && (
          <LinkButton size="sm" href={mailtoUrl(email, t("people.inviteSubject", { site: settings.siteName }), text)} icon="mail" onClick={onSent}>
            {t("visits.mail")}
          </LinkButton>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon="copy"
          onClick={async () => {
            if (await copyText(text)) {
              toast(t("common.copied"));
              onSent();
            }
          }}
        >
          {t("visits.copyMsg")}
        </Button>
      </div>
    </div>
  );
}
