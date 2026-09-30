// Private calendar: appointments (doctor, Kita, …) plus visits, month and list view.
import { useMemo, useState } from "preact/hooks";
import { REPEATS, addDays, timeToMin, minToTime, zonedNow } from "../../shared/dates";
import type { Repeat } from "../../shared/dates";
import { CATEGORIES, CATEGORY_EMOJI } from "../../shared/types";
import type { CalEvent, Category, Occurrence, Slot, Visit } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { dayLong, dayMonth } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { t } from "../lib/i18n";
import { downloadIcs, feedUrl, googleCalUrl, googleSubscribeUrl, webcalUrl } from "../lib/links";
import { store } from "../lib/storage";
import { Button, Chip, CopyField, Empty, ErrorBox, Field, Input, LinkButton, Loading, Segmented, Select, Switch, Textarea, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import { MonthGrid, gridRange } from "../ui/month";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Agenda, AgendaItem, Page, buildAgenda, byTime } from "./common";
import type { AgendaEntry } from "./common";
import { useFamily } from "./context";
import { SlotEditSheet, VisitSheet } from "./Visits";

type View = "month" | "list" | "google";
type Layers = { events: boolean; visits: boolean; slots: boolean };
interface CalData {
  events: Occurrence[];
  visits: Visit[];
  slots: Slot[];
}

export function CalendarPage() {
  const { settings, refreshBadges } = useFamily();
  const today = zonedNow(settings.timezone).date;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<View>(() => store.get<View>("nest.calView", "month"));
  const [layers, setLayers] = useState<Layers>(() => store.get("nest.calLayers", { events: true, visits: true, slots: false }));
  const [eventSheet, setEventSheet] = useState<EventSheetState>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const shownView: View = view === "google" && !settings.gcalEmbed ? "month" : view;
  const range = shownView === "list" ? { from: today, to: addDays(today, 120) } : gridRange(month);
  const { data, error, reload } = useLoad(
    () => api<CalData>(`/admin/calendar?from=${range.from}&to=${range.to}`),
    [range.from, range.to],
  );

  const events = layers.events ? (data?.events ?? []) : [];
  const visits = layers.visits ? (data?.visits ?? []) : [];
  const slots = layers.slots ? (data?.slots ?? []).filter((s) => s.bookings.length < s.capacity) : [];

  // Entries per day; multi-day events appear on every day they cover.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaEntry[]>();
    const add = (d: string, e: AgendaEntry) => map.set(d, [...(map.get(d) ?? []), e]);
    for (const ev of events) {
      const last = ev.occEnd ?? ev.occ;
      for (let d = ev.occ; d <= last; d = addDays(d, 1)) add(d, { kind: "event", ev });
    }
    for (const v of visits) if (v.date) add(v.date, { kind: "visit", v });
    for (const s of slots) add(s.date, { kind: "slot", s });
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [data, layers]);

  const changeView = (v: View) => {
    setView(v);
    store.set("nest.calView", v);
  };
  const toggleLayer = (k: keyof Layers) => {
    const next = { ...layers, [k]: !layers[k] };
    setLayers(next);
    store.set("nest.calLayers", next);
  };
  const changeMonth = (m: string) => {
    setMonth(m);
    setSelected(m === today.slice(0, 7) ? today : `${m}-01`);
  };
  const handlers = {
    onEvent: (ev: Occurrence) => setEventSheet({ event: ev }),
    onVisit: setVisit,
    onSlot: setSlot,
  };
  const dayEntries = byDay.get(selected) ?? [];

  return (
    <Page
      title={t("cal.title")}
      actions={
        <Button icon="plus" onClick={() => setEventSheet({ date: selected >= today ? selected : today })}>
          {t("cal.add")}
        </Button>
      }
    >
      <div class="toolbar">
        <Segmented
          value={shownView}
          onChange={changeView}
          options={[
            { value: "month", label: t("cal.view.month") },
            { value: "list", label: t("cal.view.list") },
            ...(settings.gcalEmbed ? [{ value: "google" as View, label: t("cal.view.google") }] : []),
          ]}
        />
        {shownView !== "google" && (
          <div class="chips">
            {(["events", "visits", "slots"] as const).map((k) => (
              <Chip key={k} active={layers[k]} onClick={() => toggleLayer(k)} class={`layer layer-${k}`}>
                {t(`cal.layer.${k}`)}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {error && <ErrorBox error={errorText(error)} onRetry={reload} />}

      {shownView === "month" && (
        <div class="cal-layout">
          <div class="card cal-card">
            <MonthGrid
              large
              month={month}
              today={today}
              selected={selected}
              onSelect={setSelected}
              onMonth={changeMonth}
              actions={
                month !== today.slice(0, 7) && (
                  <button type="button" class="text-btn" onClick={() => changeMonth(today.slice(0, 7))}>
                    {t("common.today")}
                  </button>
                )
              }
              renderDay={(d) => <DayMarks entries={byDay.get(d)} />}
            />
          </div>
          <div class="card day-card">
            <h3 class="card-title">{dayLong(selected)}</h3>
            {!data ? (
              <Loading />
            ) : dayEntries.length ? (
              <div class="agenda-items">
                {dayEntries.map((e, i) => (
                  <AgendaItem key={i} entry={e} {...handlers} />
                ))}
              </div>
            ) : (
              <p class="muted">{t("cal.empty")}</p>
            )}
            <button type="button" class="text-btn" onClick={() => setEventSheet({ date: selected })}>
              + {t("cal.addOn", { date: dayMonth(selected) })}
            </button>
          </div>
        </div>
      )}

      {shownView === "list" && (
        <div class="card">
          {!data ? (
            <Loading />
          ) : (
            (() => {
              const days = buildAgenda(events, visits, slots, today, range.to);
              return days.length ? <Agenda days={days} today={today} {...handlers} /> : <Empty emoji="🌿" title={t("cal.empty")} />;
            })()
          )}
        </div>
      )}

      {shownView === "google" && (
        <div class="card gcal">
          <iframe src={settings.gcalEmbed} title="Google Calendar" loading="lazy" referrerpolicy="no-referrer" />
        </div>
      )}

      <details class="card subscribe">
        <summary class="card-title">
          <Icon name="phone" /> {t("cal.subscribe.title")}
        </summary>
        <SubscribeFeeds />
      </details>

      <EventSheet state={eventSheet} onClose={() => setEventSheet(null)} onSaved={reload} />
      <VisitSheet
        visit={visit}
        onClose={() => setVisit(null)}
        onChanged={() => {
          reload();
          refreshBadges();
        }}
      />
      <SlotEditSheet
        slot={slot}
        onClose={() => setSlot(null)}
        onSaved={reload}
        onOpenVisit={(v) => {
          setSlot(null);
          setVisit(v);
        }}
      />
    </Page>
  );
}

function DayMarks({ entries }: { entries?: AgendaEntry[] }) {
  if (!entries?.length) return null;
  const pill = (e: AgendaEntry, i: number) => {
    if (e.kind === "event")
      return (
        <span key={i} class={cls("pill", `c-${e.ev.category}`)}>
          {e.ev.title}
        </span>
      );
    if (e.kind === "visit")
      return (
        <span key={i} class={cls("pill", `c-${e.v.kind}`, e.v.status === "pending" && "is-pending")}>
          {e.v.name}
        </span>
      );
    return (
      <span key={i} class={cls("pill", "is-slot", `c-${e.s.kind}`)}>
        {e.s.start}
      </span>
    );
  };
  return (
    <>
      {entries.slice(0, 3).map(pill)}
      {entries.length > 3 && <span class="pill more">+{entries.length - 3}</span>}
    </>
  );
}

/** The secret subscription links (used in the calendar and the settings). */
export function SubscribeFeeds() {
  const { settings } = useFamily();
  const feeds = [
    ["all", t("cal.feed.all")],
    ["family", t("cal.feed.family")],
    ["visits", t("cal.feed.visits")],
  ] as const;
  return (
    <div class="feeds">
      <p class="muted">{t("cal.subscribe.text")}</p>
      {feeds.map(([key, label]) => {
        const url = feedUrl(location.origin, settings.icsToken, key);
        return (
          <div class="feed-row" key={key}>
            <div class="feed-label">{label}</div>
            <CopyField value={url} label={label} />
            <div class="row wrap">
              <LinkButton size="sm" href={googleSubscribeUrl(url)} external icon="calendar">
                {t("cal.feed.google")}
              </LinkButton>
              <LinkButton size="sm" href={webcalUrl(url)} icon="calendar">
                {t("cal.feed.apple")}
              </LinkButton>
            </div>
          </div>
        );
      })}
      <p class="hint-box">
        <Icon name="info" size={16} /> {t("cal.subscribe.note")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- appointment editor

export type EventSheetState = { event?: CalEvent; date?: string } | null;

export function EventSheet({ state, onClose, onSaved }: { state: EventSheetState; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={!!state} onClose={onClose} title={state?.event ? t("event.edit") : t("event.new")}>
      {state && <EventForm state={state} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function EventForm({ state, onClose, onSaved }: { state: NonNullable<EventSheetState>; onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const e = state.event;
  const today = zonedNow(settings.timezone).date;
  const [title, setTitle] = useState(e?.title ?? "");
  const [category, setCategory] = useState<Category>(e?.category ?? "doctor");
  const [allDay, setAllDay] = useState(e ? !e.start : false);
  const [date, setDate] = useState(e?.date ?? state.date ?? today);
  const [endDate, setEndDate] = useState(e?.endDate ?? "");
  const [start, setStart] = useState(e?.start ?? "09:00");
  const [end, setEnd] = useState(e?.end ?? "10:00");
  const [repeat, setRepeat] = useState<Repeat>(e?.repeat ?? "none");
  const [repeatUntil, setRepeatUntil] = useState(e?.repeatUntil ?? "");
  const [locationText, setLocationText] = useState(e?.location ?? "");
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const changeStart = (v: string) => {
    // Keep the duration: move the end along with the start.
    if (v && start && end && timeToMin(end) > timeToMin(start)) {
      const duration = timeToMin(end) - timeToMin(start);
      setEnd(minToTime(Math.min(timeToMin(v) + duration, 23 * 60 + 59)));
    }
    setStart(v);
  };

  const payload = {
    title,
    category,
    date,
    endDate: allDay && endDate > date ? endDate : null,
    start: allDay ? null : start,
    end: allDay ? null : end || null,
    repeat,
    repeatUntil: repeat === "none" ? null : repeatUntil || null,
    location: locationText,
    notes,
  };
  const linkEvent = { ...payload, title: `${CATEGORY_EMOJI[category]} ${title}`, details: notes, location: locationText };

  const save = async (ev: Event) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (e) await api(`/admin/events/${e.id}`, { method: "PUT", body: payload });
      else await api("/admin/events", { body: payload });
      toast(t("common.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!e) return;
    const text = e.repeat !== "none" ? t("event.deleteSeriesConfirm") : t("event.deleteConfirm");
    if (!(await confirmDialog(text, { danger: true }))) return;
    try {
      await api(`/admin/events/${e.id}`, { method: "DELETE" });
      toast(t("common.deleted"));
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const fieldError = (f: string) => (error?.field === f ? errorText(error) : null);

  return (
    <form class="form" onSubmit={save}>
      <Field label={t("event.title")} error={fieldError("title")}>
        <Input value={title} onValue={setTitle} required maxLength={120} placeholder={t("event.titlePh")} autoFocus={!e} />
      </Field>
      <Field group label={t("event.category")}>
        <div class="chips">
          {CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} color={c} onClick={() => setCategory(c)}>
              {CATEGORY_EMOJI[c]} {t(`cat.${c}`)}
            </Chip>
          ))}
        </div>
      </Field>
      <Switch checked={allDay} onChange={setAllDay} label={t("event.allDay")} />
      <div class="grid-2">
        <Field label={t("event.date")} error={fieldError("date")}>
          <Input type="date" value={date} onValue={setDate} required />
        </Field>
        {allDay ? (
          <Field label={t("event.endDate")} error={fieldError("endDate")}>
            <Input type="date" value={endDate} min={date} onValue={setEndDate} />
          </Field>
        ) : (
          <div class="grid-2 tight">
            <Field label={t("event.start")}>
              <Input type="time" value={start} onValue={changeStart} required />
            </Field>
            <Field label={t("event.end")}>
              <Input type="time" value={end} onValue={setEnd} />
            </Field>
          </div>
        )}
      </div>
      <div class="grid-2">
        <Field label={t("event.repeat")}>
          <Select value={repeat} onValue={setRepeat} options={REPEATS.map((r) => ({ value: r, label: t(`repeat.${r}`) }))} />
        </Field>
        {repeat !== "none" && (
          <Field label={<>{t("event.repeatUntil")} <span class="opt">({t("common.optional")})</span></>} error={fieldError("repeatUntil")}>
            <Input type="date" value={repeatUntil} min={date} onValue={setRepeatUntil} />
          </Field>
        )}
      </div>
      <Field label={t("event.location")}>
        <Input value={locationText} onValue={setLocationText} maxLength={200} placeholder={t("event.locationPh")} />
      </Field>
      <Field label={t("event.notes")}>
        <Textarea value={notes} onValue={setNotes} rows={3} maxLength={4000} placeholder={t("event.notesPh")} />
      </Field>
      {e && e.repeat !== "none" && (
        <p class="hint-box">
          <Icon name="refresh" size={16} /> {t("event.series")}
        </p>
      )}
      {title && date && (
        <div class="row wrap">
          <LinkButton size="sm" href={googleCalUrl(linkEvent, settings.timezone)} external icon="calendar">
            {t("event.addGoogle")}
          </LinkButton>
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            onClick={() =>
              downloadIcs(
                [
                  {
                    uid: e?.uid ?? `${Date.now()}@nestchen`,
                    title: linkEvent.title,
                    date,
                    endDate: payload.endDate,
                    start: payload.start,
                    end: payload.end,
                    location: locationText,
                    description: notes,
                  },
                ],
                title,
                settings.timezone,
                "termin.ics",
              )
            }
          >
            {t("event.ics")}
          </Button>
        </div>
      )}
      {error && !["title", "date", "endDate", "repeatUntil"].includes(error.field ?? "") && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        {e && (
          <Button variant="danger" icon="trash" onClick={remove}>
            {t("common.delete")}
          </Button>
        )}
        <span class="spacer" />
        <Button type="submit" busy={busy} icon="check">
          {t("common.save")}
        </Button>
      </SheetActions>
    </form>
  );
}
