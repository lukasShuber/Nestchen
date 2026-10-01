// Private visits: requests inbox, planned visits, open slots and the guest-notification helper.
import { useEffect, useMemo, useState } from "preact/hooks";
import { addDays, isDate, isTime, zonedNow } from "../../shared/dates";
import { generateSlots } from "../../shared/slots";
import type { Slot, SlotKind, Visit, VisitStatus } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { ago, dayLong, dayShort, timeRange, weekdayNames } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { t, tn } from "../lib/i18n";
import { copyText, emailOf, guestMessage, mailtoUrl, phoneDigits, smsUrl, telUrl, whatsappUrl } from "../lib/links";
import {
  Button,
  Chip,
  Empty,
  ErrorBox,
  Field,
  Input,
  LinkButton,
  Loading,
  Segmented,
  Select,
  StatusBadge,
  Stepper,
  Textarea,
  cls,
} from "../ui/base";
import { Icon } from "../ui/icons";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page, VisitRow, visitEmoji } from "./common";
import { useFamily } from "./context";
import { PeopleList } from "./People";

type Tab = "open" | "upcoming" | "people" | "slots" | "past";
const TABS: Tab[] = ["open", "upcoming", "people", "slots", "past"];

export function VisitsPage() {
  const { badges, refreshBadges, settings } = useFamily();
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = location.hash.slice(1) as Tab;
    return TABS.includes(fromHash) ? fromHash : "open";
  });
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState<"slots" | "manual" | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const today = zonedNow(settings.timezone).date;

  const changed = () => {
    setVersion((v) => v + 1);
    refreshBadges();
  };
  const changeTab = (next: Tab) => {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
  };

  return (
    <Page
      title={t("visits.title")}
      actions={
        <>
          <Button variant="secondary" icon="plus" class="hide-sm" onClick={() => setSheet("manual")}>
            {t("visits.addVisit")}
          </Button>
          <Button icon="calendar" onClick={() => setSheet("slots")}>
            {t("visits.addSlots")}
          </Button>
        </>
      }
    >
      <div class="toolbar">
        <Segmented
          value={tab}
          onChange={changeTab}
          options={TABS.map((k) => ({
            value: k,
            label: t(`visits.tab.${k}`),
            badge: k === "open" ? badges.pending : k === "people" ? badges.people : undefined,
          }))}
        />
      </div>
      {tab === "people" ? (
        <PeopleList onChanged={refreshBadges} />
      ) : tab === "slots" ? (
        <SlotList version={version} today={today} onSlot={setSlot} onAdd={() => setSheet("slots")} />
      ) : (
        <VisitList scope={tab} version={version} today={today} onVisit={setVisit} />
      )}
      <button type="button" class="text-btn show-sm" onClick={() => setSheet("manual")}>
        + {t("visits.addVisit")}
      </button>

      <VisitSheet visit={visit} onClose={() => setVisit(null)} onChanged={changed} />
      <SlotsSheet open={sheet === "slots"} onClose={() => setSheet(null)} onSaved={changed} />
      <ManualVisitSheet open={sheet === "manual"} onClose={() => setSheet(null)} onSaved={changed} />
      <SlotEditSheet
        slot={slot}
        onClose={() => setSlot(null)}
        onSaved={changed}
        onOpenVisit={(v) => {
          setSlot(null);
          setVisit(v);
        }}
      />
    </Page>
  );
}

function VisitList({ scope, version, today, onVisit }: { scope: Exclude<Tab, "slots" | "people">; version: number; today: string; onVisit: (v: Visit) => void }) {
  const { data, error, reload } = useLoad(() => api<{ visits: Visit[] }>(`/admin/visits?scope=${scope}`), [scope, version]);
  if (error) return <ErrorBox error={errorText(error)} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.visits.length) {
    const empty = { open: ["☕", "visits.emptyOpen"], upcoming: ["🗓️", "visits.emptyUpcoming"], past: ["🍃", "visits.emptyPast"] } as const;
    return (
      <div class="card">
        <Empty emoji={empty[scope][0]} title={t(empty[scope][1])} />
      </div>
    );
  }
  if (scope !== "upcoming") {
    return (
      <div class="card stack">
        {data.visits.map((v) => (
          <VisitRow key={v.id} visit={v} today={today} onClick={() => onVisit(v)} />
        ))}
      </div>
    );
  }
  const groups = new Map<string, Visit[]>();
  for (const v of data.visits) groups.set(v.date!, [...(groups.get(v.date!) ?? []), v]);
  return (
    <div class="stack-lg">
      {[...groups].map(([date, visits]) => (
        <div class="card date-group" key={date}>
          <h3 class="date-title">{dayLong(date)}</h3>
          <div class="stack">
            {visits.map((v) => (
              <VisitRow key={v.id} visit={v} today={today} onClick={() => onVisit(v)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotList({ version, today, onSlot, onAdd }: { version: number; today: string; onSlot: (s: Slot) => void; onAdd: () => void }) {
  const { data, error, reload } = useLoad(() => api<{ slots: Slot[] }>(`/admin/slots?from=${today}`), [version, today]);
  if (error) return <ErrorBox error={errorText(error)} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.slots.length) {
    return (
      <div class="card">
        <Empty emoji="🫖" title={t("visits.emptySlots")}>
          <Button icon="plus" onClick={onAdd}>
            {t("visits.addSlots")}
          </Button>
        </Empty>
      </div>
    );
  }
  const groups = new Map<string, Slot[]>();
  for (const s of data.slots) groups.set(s.date, [...(groups.get(s.date) ?? []), s]);
  return (
    <div class="stack-lg">
      {[...groups].map(([date, slots]) => (
        <div class="card date-group" key={date}>
          <h3 class="date-title">{dayLong(date)}</h3>
          <div class="stack">
            {slots.map((s) => {
              const free = s.capacity - s.bookings.length;
              return (
                <button type="button" class="slot slot-admin" key={s.id} onClick={() => onSlot(s)}>
                  <span class={`slot-icon k-${s.kind}`} aria-hidden="true">
                    {visitEmoji(s)}
                  </span>
                  <span class="slot-main">
                    <span class="slot-time">{timeRange(s.start, s.end)}</span>
                    <span class="slot-meta">
                      {s.bookings.length
                        ? s.bookings.map((b) => `${b.name} (${b.status === "confirmed" ? t("visits.slotBooked") : t("visits.slotRequested")})`).join(", ")
                        : s.note || t(`kind.${s.kind}`)}
                    </span>
                  </span>
                  <span class={cls("badge", free > 0 ? "badge-free" : "status-confirmed")}>
                    {free > 0 ? `${free} ${t("visits.slotFree")}` : t("visits.slotBooked")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- one visit / request

export function VisitSheet({ visit, onClose, onChanged }: { visit: Visit | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!visit} onClose={onClose} title={visit ? `${visitEmoji(visit)} ${visit.name}` : ""}>
      {visit && <VisitDetail key={visit.id} initial={visit} onChanged={onChanged} onClose={onClose} />}
    </Sheet>
  );
}

function VisitDetail({ initial, onChanged, onClose }: { initial: Visit; onChanged: () => void; onClose: () => void }) {
  const { settings } = useFamily();
  const [v, setV] = useState(initial);
  const first = v.proposals[0];
  const [date, setDate] = useState(v.date ?? first?.date ?? "");
  const [start, setStart] = useState(v.start ?? first?.start ?? "");
  const [end, setEnd] = useState(v.end ?? first?.end ?? "");
  const [reply, setReply] = useState(v.reply);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(v.name);
  const [contact, setContact] = useState(v.contact);
  const [partySize, setPartySize] = useState(v.partySize);
  const [message, setMessage] = useState(v.message);
  const [bring, setBring] = useState(v.bring);
  const [showNotify, setShowNotify] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const phone = phoneDigits(v.contact, settings.phoneCc);
  const email = emailOf(v.contact);

  const save = async (status?: VisitStatus) => {
    setBusy(status ?? "save");
    setError(null);
    try {
      const body: Record<string, unknown> = { reply, date: date || null, start: start || null, end: start && end ? end : null };
      if (status) body.status = status;
      if (editing) Object.assign(body, { name, contact, partySize, message, bring });
      const r = await api<{ visit: Visit }>(`/admin/visits/${v.id}`, { method: "PATCH", body });
      setV(r.visit);
      setEditing(false);
      onChanged();
      if (status && status !== "pending") {
        toast(t(status === "confirmed" ? "visits.confirmed" : status === "declined" ? "visits.declined" : "visits.cancelled"));
        setShowNotify(true);
      } else {
        toast(t("common.saved"));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog(t("visits.deleteConfirm"), { danger: true }))) return;
    try {
      await api(`/admin/visits/${v.id}`, { method: "DELETE" });
      toast(t("common.deleted"));
      onChanged();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const copyLink = async () => {
    if (await copyText(`${location.origin}/r/${v.token}`)) toast(t("common.copied"));
  };

  return (
    <div class="form visit-detail">
      <div class="visit-head">
        <StatusBadge status={v.status} />
        <span class="muted small">{t("visits.requested", { when: ago(v.createdAt) })}</span>
      </div>

      {!editing ? (
        <dl class="facts">
          {v.kind === "visit" && (
            <div>
              <dt>
                <Icon name="visits" size={18} />
              </dt>
              <dd>{tn("common.persons", v.partySize)}</dd>
            </div>
          )}
          {v.contact && (
            <div>
              <dt>
                <Icon name="phone" size={18} />
              </dt>
              <dd>
                <span class="selectable">{v.contact}</span>
                <div class="row wrap contact-actions">
                  {phone && (
                    <LinkButton size="sm" href={telUrl(phone)} icon="phone">
                      {t("visits.call")}
                    </LinkButton>
                  )}
                  {phone && (
                    <LinkButton size="sm" href={whatsappUrl(phone, "")} external icon="chat">
                      {t("visits.whatsapp")}
                    </LinkButton>
                  )}
                  {email && (
                    <LinkButton size="sm" href={`mailto:${email}`} icon="mail">
                      {t("visits.mail")}
                    </LinkButton>
                  )}
                </div>
              </dd>
            </div>
          )}
          {v.bring && (
            <div>
              <dt aria-label={t("visits.bring")}>🍲</dt>
              <dd>{v.bring}</dd>
            </div>
          )}
          {v.message && (
            <div>
              <dt>
                <Icon name="chat" size={18} />
              </dt>
              <dd class="quote">{v.message}</dd>
            </div>
          )}
        </dl>
      ) : (
        <div class="subform">
          <Field label={t("pub.form.name")}>
            <Input value={name} onValue={setName} required maxLength={80} />
          </Field>
          <Field label={t("visits.contact")}>
            <Input value={contact} onValue={setContact} maxLength={120} />
          </Field>
          {v.kind === "visit" ? (
            <Field group label={t("pub.form.party")}>
              <Stepper value={partySize} onChange={setPartySize} min={1} max={20} label={t("pub.form.party")} />
            </Field>
          ) : (
            <Field label={t("visits.bring")}>
              <Input value={bring} onValue={setBring} maxLength={200} />
            </Field>
          )}
          <Field label={t("visits.message")}>
            <Textarea value={message} onValue={setMessage} rows={2} maxLength={1000} />
          </Field>
        </div>
      )}

      <Field group label={t("visits.when")} error={error?.field === "date" || error?.field === "end" ? errorText(error) : null}>
        {v.source === "proposal" && v.proposals.length > 0 && (
          <div class="proposal-picks">
            <span class="field-hint">{t("visits.pickProposal")}</span>
            <div class="chips">
              {v.proposals.map((p, i) => (
                <Chip
                  key={i}
                  active={p.date === date && (p.start ?? "") === start}
                  onClick={() => {
                    setDate(p.date);
                    setStart(p.start ?? "");
                    setEnd(p.end ?? "");
                  }}
                >
                  {dayShort(p.date)}
                  {p.start ? `, ${timeRange(p.start, p.end)}` : ""}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div class="when-row">
          <Input type="date" value={date} onValue={setDate} aria-label={t("common.date")} />
          <Input type="time" value={start} onValue={setStart} aria-label={t("common.from")} />
          <span class="dash" aria-hidden="true">
            –
          </span>
          <Input type="time" value={end} onValue={setEnd} aria-label={t("common.to")} disabled={!start} />
        </div>
      </Field>

      <Field label={t("visits.reply")} hint={t("visits.replyHint")}>
        <Textarea value={reply} onValue={setReply} rows={2} maxLength={1000} />
      </Field>

      {error && !["date", "end"].includes(error.field ?? "") && <ErrorBox error={errorText(error)} />}

      {showNotify && <NotifyPanel visit={v} />}

      <div class="row wrap small-actions">
        {!showNotify && (
          <Button size="sm" variant="ghost" icon="send" onClick={() => setShowNotify(true)}>
            {t("visits.notify")}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="link" onClick={copyLink}>
          {t("visits.statusLink")}
        </Button>
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(!editing)}>
          {t("visits.details")}
        </Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={remove}>
          {t("common.delete")}
        </Button>
      </div>

      <SheetActions>
        {v.status === "pending" && (
          <>
            <Button variant="secondary" icon="x" busy={busy === "declined"} onClick={() => save("declined")}>
              {t("visits.decline")}
            </Button>
            <Button icon="check" busy={busy === "confirmed"} onClick={() => save("confirmed")}>
              {t("visits.confirm")}
            </Button>
          </>
        )}
        {v.status === "confirmed" && (
          <>
            <Button variant="secondary" busy={busy === "cancelled"} onClick={() => save("cancelled")}>
              {t("visits.cancelVisit")}
            </Button>
            <Button icon="check" busy={busy === "save"} onClick={() => save()}>
              {t("visits.saveChanges")}
            </Button>
          </>
        )}
        {(v.status === "declined" || v.status === "cancelled") && (
          <Button variant="secondary" icon="refresh" busy={busy === "pending"} onClick={() => save("pending")}>
            {t("visits.reopen")}
          </Button>
        )}
      </SheetActions>
    </div>
  );
}

/** Pre-written message to the guest, sent with one tap via WhatsApp, SMS or e-mail. */
function NotifyPanel({ visit }: { visit: Visit }) {
  const { settings } = useFamily();
  const message = guestMessage(visit, location.origin, settings.siteName);
  const [text, setText] = useState(message.body);
  useEffect(() => setText(message.body), [visit.status, visit.date, visit.start, visit.end, visit.reply]);
  const phone = phoneDigits(visit.contact, settings.phoneCc);
  const email = emailOf(visit.contact);
  return (
    <div class="notify">
      <p class="notify-title">
        <Icon name="send" size={18} /> {t("visits.notifyText")}
      </p>
      <Textarea value={text} onValue={setText} rows={5} />
      <div class="row wrap">
        {phone && (
          <LinkButton size="sm" variant="primary" class="btn-whatsapp" href={whatsappUrl(phone, text)} external icon="chat">
            {t("visits.whatsapp")}
          </LinkButton>
        )}
        {phone && (
          <LinkButton size="sm" href={smsUrl(phone, text)} icon="phone">
            {t("visits.sms")}
          </LinkButton>
        )}
        {email && (
          <LinkButton size="sm" href={mailtoUrl(email, message.subject, text)} icon="mail">
            {t("visits.mail")}
          </LinkButton>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon="copy"
          onClick={async () => {
            if (await copyText(text)) toast(t("common.copied"));
          }}
        >
          {t("visits.copyMsg")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- offering slots

const KIND_DEFAULTS: Record<SlotKind, { start: string; end: string; weekdays: number[]; split: number }> = {
  visit: { start: "15:00", end: "17:00", weekdays: [5, 6], split: 60 },
  meal: { start: "17:30", end: "19:00", weekdays: [0, 1, 2, 3, 4], split: 0 },
};

export function SlotsSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t("visits.slotsSheet.title")}>
      {open && <SlotsForm onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function SlotsForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const today = zonedNow(settings.timezone).date;
  const initialKind: SlotKind = settings.showVisits || !settings.showMeals ? "visit" : "meal";
  const [kind, setKind] = useState<SlotKind>(initialKind);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 13));
  const [weekdays, setWeekdays] = useState<number[]>(KIND_DEFAULTS[initialKind].weekdays);
  const [start, setStart] = useState(KIND_DEFAULTS[initialKind].start);
  const [end, setEnd] = useState(KIND_DEFAULTS[initialKind].end);
  const [split, setSplit] = useState(KIND_DEFAULTS[initialKind].split);
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const changeKind = (k: SlotKind) => {
    setKind(k);
    const d = KIND_DEFAULTS[k];
    setStart(d.start);
    setEnd(d.end);
    setWeekdays(d.weekdays);
    setSplit(d.split);
  };

  const preview = useMemo(
    () =>
      isDate(from) && isDate(to) && isTime(start) && isTime(end)
        ? generateSlots({ from, to: to < from ? from : to, weekdays, start, end, split })
        : [],
    [from, to, weekdays, start, end, split],
  );

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number }>("/admin/slots", {
        body: { kind, from, to: to < from ? from : to, weekdays, start, end, split, capacity, note },
      });
      toast(tn("visits.slotsSheet.created", r.created));
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
      {settings.showVisits && settings.showMeals && (
        <Field group label={t("visits.slotsSheet.kind")}>
          <Segmented
            value={kind}
            onChange={changeKind}
            options={[
              { value: "visit", label: `☕ ${t("kind.visit")}` },
              { value: "meal", label: `🍲 ${t("kind.meal")}` },
            ]}
          />
        </Field>
      )}
      <div class="grid-2">
        <Field label={t("common.from")}>
          <Input type="date" value={from} min={today} onValue={setFrom} required />
        </Field>
        <Field label={t("common.to")}>
          <Input type="date" value={to} min={from} onValue={setTo} required />
        </Field>
      </div>
      {from !== to && (
        <Field group label={t("visits.slotsSheet.days")}>
          <div class="weekday-picker">
            {weekdayNames().map((w, i) => (
              <Chip
                key={i}
                active={weekdays.includes(i)}
                onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i])}
              >
                {w}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      <div class="grid-2">
        <Field group label={t("visits.slotsSheet.time")}>
          <div class="when-row">
            <Input type="time" value={start} onValue={setStart} required aria-label={t("common.from")} />
            <span class="dash" aria-hidden="true">
              –
            </span>
            <Input type="time" value={end} onValue={setEnd} required aria-label={t("common.to")} />
          </div>
        </Field>
        <Field label={t("visits.slotsSheet.split")}>
          <Select
            value={String(split)}
            onValue={(v) => setSplit(Number(v))}
            options={[0, 30, 45, 60, 90, 120].map((n) => ({
              value: String(n),
              label: n ? t("visits.slotsSheet.splitMin", { n }) : t("visits.slotsSheet.splitNone"),
            }))}
          />
        </Field>
      </div>
      <Field group label={t("visits.slotsSheet.capacity")}>
        <Stepper value={capacity} onChange={setCapacity} min={1} max={10} label={t("visits.slotsSheet.capacity")} />
      </Field>
      <Field label={<>{t("visits.slotsSheet.note")} <span class="opt">({t("common.optional")})</span></>}>
        <Input value={note} onValue={setNote} maxLength={200} placeholder={t("visits.slotsSheet.notePh")} />
      </Field>
      <div class="preview" aria-live="polite">
        {preview.length ? (
          <>
            <strong>{tn("visits.slotsSheet.preview", preview.length)}</strong>
            <div class="preview-list">
              {preview.slice(0, 6).map((s, i) => (
                <span class="pill" key={i}>
                  {dayShort(s.date)} {s.start}–{s.end}
                </span>
              ))}
              {preview.length > 6 && <span class="pill">+{preview.length - 6}</span>}
            </div>
          </>
        ) : (
          <span class="muted">{t("err.no_slots")}</span>
        )}
      </div>
      {!!error && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        <Button type="submit" block busy={busy} disabled={!preview.length} icon="check">
          {t("common.create")}
        </Button>
      </SheetActions>
    </form>
  );
}

export function SlotEditSheet({ slot, onClose, onSaved, onOpenVisit }: { slot: Slot | null; onClose: () => void; onSaved: () => void; onOpenVisit: (v: Visit) => void }) {
  return (
    <Sheet open={!!slot} onClose={onClose} title={t("visits.slotEdit.title")}>
      {slot && <SlotEditForm key={slot.id} slot={slot} onClose={onClose} onSaved={onSaved} onOpenVisit={onOpenVisit} />}
    </Sheet>
  );
}

function SlotEditForm({ slot, onClose, onSaved, onOpenVisit }: { slot: Slot; onClose: () => void; onSaved: () => void; onOpenVisit: (v: Visit) => void }) {
  const [kind, setKind] = useState<SlotKind>(slot.kind);
  const [date, setDate] = useState(slot.date);
  const [start, setStart] = useState(slot.start);
  const [end, setEnd] = useState(slot.end);
  const [capacity, setCapacity] = useState(slot.capacity);
  const [note, setNote] = useState(slot.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/slots/${slot.id}`, { method: "PUT", body: { kind, date, start, end, capacity, note } });
      toast(t("common.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog(t("visits.slotDeleteConfirm"), { danger: true }))) return;
    await api(`/admin/slots/${slot.id}`, { method: "DELETE" }).catch((err) => toast(errorText(err), "error"));
    onSaved();
    onClose();
  };
  const openBooking = async (id: number) => {
    try {
      const r = await api<{ visit: Visit }>(`/admin/visits/${id}`);
      onOpenVisit(r.visit);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <form class="form" onSubmit={save}>
      {slot.bookings.length > 0 && (
        <div class="stack">
          {slot.bookings.map((b) => (
            <button type="button" class="booking-row" key={b.id} onClick={() => openBooking(b.id)}>
              <span>
                {b.name} · {tn("common.persons", b.partySize)}
              </span>
              <StatusBadge status={b.status} />
            </button>
          ))}
        </div>
      )}
      <Field group label={t("visits.slotsSheet.kind")}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "visit", label: `☕ ${t("kind.visit")}` },
            { value: "meal", label: `🍲 ${t("kind.meal")}` },
          ]}
        />
      </Field>
      <Field group label={t("visits.when")}>
        <div class="when-row">
          <Input type="date" value={date} onValue={setDate} required aria-label={t("common.date")} />
          <Input type="time" value={start} onValue={setStart} required aria-label={t("common.from")} />
          <span class="dash" aria-hidden="true">
            –
          </span>
          <Input type="time" value={end} onValue={setEnd} required aria-label={t("common.to")} />
        </div>
      </Field>
      <Field group label={t("visits.slotsSheet.capacity")}>
        <Stepper value={capacity} onChange={setCapacity} min={1} max={10} label={t("visits.slotsSheet.capacity")} />
      </Field>
      <Field label={t("visits.slotsSheet.note")}>
        <Input value={note} onValue={setNote} maxLength={200} placeholder={t("visits.slotsSheet.notePh")} />
      </Field>
      {!!error && <ErrorBox error={errorText(error)} />}
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

function ManualVisitSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t("visits.manual.title")}>
      {open && <ManualVisitForm onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ManualVisitForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const today = zonedNow(settings.timezone).date;
  const [kind, setKind] = useState<SlotKind>("visit");
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("16:00");
  const [partySize, setPartySize] = useState(1);
  const [bring, setBring] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/visits", {
        body: { kind, name, date, start: start || null, end: start && end ? end : null, partySize, bring, contact, message, status: "confirmed" },
      });
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
      <Field group label={t("visits.slotsSheet.kind")}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "visit", label: `☕ ${t("kind.visit")}` },
            { value: "meal", label: `🍲 ${t("kind.meal")}` },
          ]}
        />
      </Field>
      <Field label={t("pub.form.name")}>
        <Input value={name} onValue={setName} required maxLength={80} placeholder={t("pub.form.namePh")} autoFocus />
      </Field>
      <Field group label={t("visits.when")}>
        <div class="when-row">
          <Input type="date" value={date} onValue={setDate} required aria-label={t("common.date")} />
          <Input type="time" value={start} onValue={setStart} aria-label={t("common.from")} />
          <span class="dash" aria-hidden="true">
            –
          </span>
          <Input type="time" value={end} onValue={setEnd} aria-label={t("common.to")} disabled={!start} />
        </div>
      </Field>
      {kind === "visit" ? (
        <Field group label={t("pub.form.party")}>
          <Stepper value={partySize} onChange={setPartySize} min={1} max={20} label={t("pub.form.party")} />
        </Field>
      ) : (
        <Field label={t("visits.bring")}>
          <Input value={bring} onValue={setBring} maxLength={200} placeholder={t("pub.form.bringPh")} />
        </Field>
      )}
      <Field label={<>{t("visits.contact")} <span class="opt">({t("common.optional")})</span></>}>
        <Input value={contact} onValue={setContact} maxLength={120} />
      </Field>
      <Field label={<>{t("visits.message")} <span class="opt">({t("common.optional")})</span></>}>
        <Textarea value={message} onValue={setMessage} rows={2} maxLength={1000} />
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
