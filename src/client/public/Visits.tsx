// Public: the visit & meal calendar with request forms.
import { useMemo, useState } from "preact/hooks";
import type { Proposal, PublicInfo, PublicSlot, SlotKind } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { dayLong, timeRange } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { getLang, t } from "../lib/i18n";
import { navigate } from "../lib/router";
import { store } from "../lib/storage";
import { Button, CopyField, Empty, ErrorBox, Field, IconButton, Input, Loading, Segmented, Stepper, Textarea, cls } from "../ui/base";
import { WeeksGrid, weekStart } from "../ui/month";
import { Sheet, SheetActions } from "../ui/sheet";
import { pickText, saveRequest } from "./PublicApp";

type Filter = "all" | SlotKind;

export function VisitSection({ info, onRequested }: { info: PublicInfo; onRequested: () => void }) {
  const f = info.features!;
  const both = f.visits && f.meals;
  const { data, error, reload } = useLoad(
    () => api<{ slots: PublicSlot[]; now: { date: string; time: string } }>("/public/slots"),
    [],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [start, setStart] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ slot?: PublicSlot; kind: SlotKind } | null>(null);

  const today = data?.now.date ?? info.now!.date;
  const slots = useMemo(() => (data?.slots ?? []).filter((s) => filter === "all" || s.kind === filter), [data, filter]);
  const byDate = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of slots) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  }, [slots]);
  const free = slots.filter((s) => s.free > 0);
  const thisWeek = weekStart(today);
  const shownStart = start ?? thisWeek;
  const list = selected ? (byDate.get(selected) ?? []) : free.slice(0, 8);
  const groups = new Map<string, PublicSlot[]>();
  for (const s of list) groups.set(s.date, [...(groups.get(s.date) ?? []), s]);
  const rules = pickText(info.texts?.visitRules);
  const mealNotes = pickText(info.texts?.mealNotes);
  const title = both ? t("pub.visits.titleBoth") : f.visits ? t("pub.visits.titleVisit") : t("pub.visits.titleMeal");
  const proposeKind: SlotKind = filter === "meal" || !f.visits ? "meal" : "visit";

  return (
    <section class="section" id="besuch" aria-labelledby="besuch-title">
      <div class="section-head">
        <h2 id="besuch-title">{title}</h2>
        <p class="lead">{t("pub.visits.lead")}</p>
      </div>

      {((f.visits && rules) || (f.meals && mealNotes)) && (
        <div class="note-grid">
          {f.visits && rules && (
            <details class="note" open>
              <summary>🙏 {t("pub.rules.title")}</summary>
              <ul class="rules">
                {rules
                  .split("\n")
                  .filter((r) => r.trim())
                  .map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
              </ul>
            </details>
          )}
          {f.meals && mealNotes && (
            <details class="note note-meal" open>
              <summary>🍲 {t("pub.mealNotes.title")}</summary>
              <p>{mealNotes}</p>
            </details>
          )}
        </div>
      )}

      {both && (
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setSelected(null);
            setStart(null);
          }}
          options={[
            { value: "all", label: t("pub.filter.all") },
            { value: "visit", label: t("pub.filter.visit") },
            { value: "meal", label: t("pub.filter.meal") },
          ]}
        />
      )}

      {error ? (
        <ErrorBox error={errorText(error)} onRetry={reload} />
      ) : (
        <div class="visit-layout">
          <div class="card cal-card">
            <WeeksGrid
              start={shownStart}
              weeks={5}
              minStart={thisWeek}
              today={today}
              selected={selected}
              onSelect={(d) => setSelected(d === selected ? null : d)}
              onStart={(s) => {
                setStart(s);
                setSelected(null);
              }}
              renderDay={(d) =>
                d >= today &&
                byDate
                  .get(d)
                  ?.slice(0, 3)
                  .map((s) => <i key={s.id} class={cls("mark", `k-${s.kind}`, s.free === 0 && "is-full")} />)
              }
              dayClass={(d) => d >= today && byDate.get(d)?.some((s) => s.free > 0) && "has-free"}
            />
            {both && (
              <div class="legend">
                <span>
                  <i class="mark k-visit" /> {t("kind.visit")}
                </span>
                <span>
                  <i class="mark k-meal" /> {t("kind.meal")}
                </span>
              </div>
            )}
          </div>
          <div class="card slot-card">
            <h3 class="card-title">{selected ? dayLong(selected) : t("pub.slots.upcoming")}</h3>
            {!data ? (
              <Loading />
            ) : list.length ? (
              <div class="slot-list">
                {[...groups].map(([date, daySlots]) => (
                  <div class="slot-group" key={date}>
                    {!selected && <div class="slot-group-date">{dayLong(date)}</div>}
                    {daySlots.map((s) => (
                      <SlotRow key={s.id} slot={s} onRequest={() => setSheet({ slot: s, kind: s.kind })} />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji={selected ? "🌙" : "🫖"} title={selected ? t("pub.slots.noneDay") : t("pub.slots.none")}>
                {!selected && <p class="muted">{t("pub.slots.noneHint")}</p>}
              </Empty>
            )}
            {selected && (
              <button type="button" class="text-btn" onClick={() => setSelected(null)}>
                {t("pub.slot.showAll")}
              </button>
            )}
          </div>
        </div>
      )}

      <div class="propose">
        <Button variant="soft" icon="send" onClick={() => setSheet({ kind: proposeKind })}>
          {t("pub.propose.cta")}
        </Button>
      </div>

      <Sheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={
          sheet?.slot
            ? t(sheet.slot.kind === "meal" ? "pub.form.titleMeal" : "pub.form.titleVisit")
            : t("pub.propose.title")
        }
      >
        {sheet && (
          <RequestForm
            slot={sheet.slot}
            initialKind={sheet.kind}
            info={info}
            today={today}
            onDone={() => {
              reload();
              onRequested();
            }}
            onClose={() => setSheet(null)}
          />
        )}
      </Sheet>
    </section>
  );
}

function SlotRow({ slot, onRequest }: { slot: PublicSlot; onRequest: () => void }) {
  const full = slot.free === 0;
  return (
    <div class={cls("slot", full && "is-full")}>
      <span class={`slot-icon k-${slot.kind}`} aria-hidden="true">
        {slot.kind === "meal" ? "🍲" : "☕"}
      </span>
      <div class="slot-main">
        <div class="slot-time">{timeRange(slot.start, slot.end)}</div>
        <div class="slot-meta">
          {t(`kind.${slot.kind}`)}
          {slot.capacity > 1 && !full && ` · ${t("pub.slot.left", { n: slot.free })}`}
          {slot.note && ` · ${slot.note}`}
        </div>
      </div>
      {full ? (
        <span class="badge">{t("pub.slot.taken")}</span>
      ) : (
        <Button size="sm" onClick={onRequest}>
          {t("pub.slot.request")}
        </Button>
      )}
    </div>
  );
}

type Option = { date: string; start: string; end: string };

function RequestForm({
  slot,
  initialKind,
  info,
  today,
  onDone,
  onClose,
}: {
  slot?: PublicSlot;
  initialKind: SlotKind;
  info: PublicInfo;
  today: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const f = info.features!;
  const [kind, setKind] = useState<SlotKind>(slot?.kind ?? initialKind);
  const [name, setName] = useState(() => store.get("nest.guestName", ""));
  const [contact, setContact] = useState(() => store.get("nest.guestContact", ""));
  const [party, setParty] = useState(1);
  const [bring, setBring] = useState("");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<Option[]>([{ date: "", start: "", end: "" }]);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ token: string; status: string } | null>(null);
  const mealNotes = pickText(info.texts?.mealNotes);

  const update = (i: number, patch: Partial<Option>) =>
    setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const proposals: Proposal[] = options
        .filter((o) => o.date)
        .map((o) => ({ date: o.date, start: o.start || null, end: o.start && o.end ? o.end : null }));
      const r = await api<{ token: string; status: string }>("/public/requests", {
        body: {
          kind,
          name,
          contact,
          partySize: party,
          bring,
          message,
          website,
          lang: getLang(),
          ...(slot ? { slotId: slot.id } : { proposals }),
        },
      });
      store.set("nest.guestName", name);
      store.set("nest.guestContact", contact);
      saveRequest({ token: r.token, kind, createdAt: Date.now() });
      setResult(r);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  if (result) return <RequestDone token={result.token} confirmed={result.status === "confirmed"} onClose={onClose} />;

  const fieldError = (field: string) => (error?.field === field ? errorText(error) : null);
  const optional = <span class="opt">({t("common.optional")})</span>;

  return (
    <form class="form" onSubmit={submit}>
      {slot ? (
        <div class={`slot-summary k-${slot.kind}`}>
          <span class="slot-summary-icon" aria-hidden="true">
            {slot.kind === "meal" ? "🍲" : "☕"}
          </span>
          <div>
            <strong>{dayLong(slot.date)}</strong>
            <div>
              {timeRange(slot.start, slot.end)}
              {slot.note && ` · ${slot.note}`}
            </div>
          </div>
        </div>
      ) : (
        <>
          {f.visits && f.meals && (
            <Field group label={t("pub.form.kind")}>
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: "visit", label: t("pub.form.kindVisit") },
                  { value: "meal", label: t("pub.form.kindMeal") },
                ]}
              />
            </Field>
          )}
          <Field group label={t("pub.form.options")} hint={t("pub.form.optionsHint")} error={fieldError("proposals")}>
            {options.map((o, i) => (
              <div class="proposal-row" key={i}>
                <Input
                  type="date"
                  value={o.date}
                  min={today}
                  onValue={(v) => update(i, { date: v })}
                  required={i === 0}
                  aria-label={t("pub.form.option", { n: i + 1 })}
                />
                <Input type="time" value={o.start} onValue={(v) => update(i, { start: v })} aria-label={t("common.from")} />
                <span class="dash" aria-hidden="true">
                  –
                </span>
                <Input
                  type="time"
                  value={o.end}
                  onValue={(v) => update(i, { end: v })}
                  aria-label={t("common.to")}
                  disabled={!o.start}
                />
                {options.length > 1 && (
                  <IconButton
                    icon="x"
                    label={t("pub.form.removeOption")}
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            ))}
            {options.length < 3 && (
              <button type="button" class="text-btn" onClick={() => setOptions([...options, { date: "", start: "", end: "" }])}>
                + {t("pub.form.addOption")}
              </button>
            )}
          </Field>
        </>
      )}

      {kind === "meal" && mealNotes && <p class="note-inline">🍲 {mealNotes}</p>}

      <Field label={kind === "meal" ? t("pub.form.nameMeal") : t("pub.form.name")} error={fieldError("name")}>
        <Input value={name} onValue={setName} required maxLength={80} placeholder={t("pub.form.namePh")} autoComplete="name" />
      </Field>
      {kind === "visit" && (
        <Field group label={t("pub.form.party")}>
          <Stepper value={party} onChange={setParty} min={1} max={20} label={t("pub.form.party")} />
        </Field>
      )}
      {kind === "meal" && (
        <Field label={t("pub.form.bring")} error={fieldError("bring")}>
          <Input value={bring} onValue={setBring} maxLength={200} placeholder={t("pub.form.bringPh")} />
        </Field>
      )}
      <Field label={<>{t("pub.form.contact")} {optional}</>} hint={t("pub.form.contactHint")} error={fieldError("contact")}>
        <Input value={contact} onValue={setContact} maxLength={120} autoComplete="tel" />
      </Field>
      <Field label={<>{t("pub.form.message")} {optional}</>} error={fieldError("message")}>
        <Textarea value={message} onValue={setMessage} rows={3} maxLength={1000} placeholder={t("pub.form.messagePh")} />
      </Field>
      <div class="hp" aria-hidden="true">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onInput={(e) => setWebsite(e.currentTarget.value)} />
        </label>
      </div>
      {error && !error.field && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        <Button type="submit" busy={busy} icon="send" block>
          {t("pub.form.submit")}
        </Button>
      </SheetActions>
    </form>
  );
}

function RequestDone({ token, confirmed, onClose }: { token: string; confirmed: boolean; onClose: () => void }) {
  const link = `${location.origin}/r/${token}`;
  const canShare = typeof navigator.share === "function";
  return (
    <div class="done">
      <div class="done-emoji" aria-hidden="true">
        💌
      </div>
      <h3>{t("pub.done.title")}</h3>
      <p>{confirmed ? t("pub.done.confirmed") : t("pub.done.pending")}</p>
      <p class="muted small">{t("pub.done.link")}</p>
      <CopyField value={link} />
      <SheetActions>
        {canShare && (
          <Button variant="secondary" icon="share" onClick={() => navigator.share({ url: link }).catch(() => {})}>
            {t("pub.done.share")}
          </Button>
        )}
        <Button
          icon="chevronRight"
          onClick={() => {
            onClose();
            navigate(`/r/${token}`);
          }}
        >
          {t("pub.done.open")}
        </Button>
      </SheetActions>
    </div>
  );
}
