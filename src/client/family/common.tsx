// Pieces shared by several pages of the private area.
import type { ComponentChildren } from "preact";
import { diffDays } from "../../shared/dates";
import { CATEGORY_EMOJI } from "../../shared/types";
import type { ListKind, Occurrence, Slot, User, Visit } from "../../shared/types";
import { dayMonth, dayShort, relDay, timeRange } from "../lib/format";
import { t, tn } from "../lib/i18n";
import { hostOf } from "../lib/links";
import { Link } from "../lib/router";
import { StatusBadge, cls } from "../ui/base";
import { Icon } from "../ui/icons";

export function Page({ title, subtitle, actions, back, children }: { title: ComponentChildren; subtitle?: ComponentChildren; actions?: ComponentChildren; back?: string; children: ComponentChildren }) {
  return (
    <div class="page">
      <header class="page-head">
        {back && (
          <Link href={back} class="icon-btn back-btn" aria-label={t("common.back")}>
            <Icon name="chevronLeft" size={22} />
          </Link>
        )}
        <div class="page-titles">
          <h1 class="page-title">{title}</h1>
          {subtitle && <p class="page-sub">{subtitle}</p>}
        </div>
        {actions && <div class="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export const KIND_EMOJI: Record<ListKind, string> = {
  todo: "✅",
  shopping: "🛒",
  wishlist: "🎁",
  contacts: "📞",
  gifts: "🎀",
  notes: "📝",
};

export const visitEmoji = (v: { kind: string }) => (v.kind === "meal" ? "🍲" : "☕");

// ---------------------------------------------------------------- agenda

export type AgendaEntry = { kind: "event"; ev: Occurrence } | { kind: "visit"; v: Visit } | { kind: "slot"; s: Slot };
export interface AgendaDay {
  date: string;
  entries: AgendaEntry[];
}

const startOf = (e: AgendaEntry) => (e.kind === "event" ? (e.ev.start ?? "") : e.kind === "visit" ? (e.v.start ?? "") : e.s.start);
export const byTime = (a: AgendaEntry, b: AgendaEntry) => startOf(a).localeCompare(startOf(b));

/** Group events, visits and open slots by day (multi-day events appear on their first visible day). */
export function buildAgenda(events: Occurrence[], visits: Visit[], slots: Slot[], from: string, to: string): AgendaDay[] {
  const map = new Map<string, AgendaEntry[]>();
  const add = (date: string, e: AgendaEntry) => {
    if (date < from || date > to) return;
    map.set(date, [...(map.get(date) ?? []), e]);
  };
  for (const ev of events) add(ev.occ < from ? from : ev.occ, { kind: "event", ev });
  for (const v of visits) if (v.date) add(v.date, { kind: "visit", v });
  for (const s of slots) add(s.date, { kind: "slot", s });
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({ date, entries: entries.sort(byTime) }));
}

export interface AgendaHandlers {
  onEvent: (ev: Occurrence) => void;
  onVisit: (v: Visit) => void;
  onSlot?: (s: Slot) => void;
}

export function Agenda({ days, today, ...handlers }: { days: AgendaDay[]; today: string } & AgendaHandlers) {
  return (
    <div class="agenda">
      {days.map((d) => (
        <div class={cls("agenda-day", d.date === today && "is-today")} key={d.date}>
          <div class="agenda-date">
            <span class="agenda-rel">{relDay(d.date, today)}</span>
            {Math.abs(diffDays(today, d.date)) <= 1 && <span class="agenda-full">{dayShort(d.date)}</span>}
          </div>
          <div class="agenda-items">
            {d.entries.map((e, i) => (
              <AgendaItem key={i} entry={e} {...handlers} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgendaItem({ entry, onEvent, onVisit, onSlot }: { entry: AgendaEntry } & AgendaHandlers) {
  if (entry.kind === "event") {
    const ev = entry.ev;
    const sub = [ev.location, ev.occEnd && t("cal.until", { date: dayMonth(ev.occEnd) })].filter(Boolean).join(" · ");
    return (
      <button type="button" class={cls("agenda-item", `c-${ev.category}`)} onClick={() => onEvent(ev)}>
        <span class="agenda-time">{ev.start ?? t("cal.allDay")}</span>
        <span class="agenda-text">
          <span class="agenda-title">
            {CATEGORY_EMOJI[ev.category]} {ev.title}
          </span>
          {sub && <span class="agenda-sub">{sub}</span>}
        </span>
        {ev.repeat !== "none" && <Icon name="refresh" size={14} class="muted" />}
      </button>
    );
  }
  if (entry.kind === "visit") {
    const v = entry.v;
    return (
      <button type="button" class={cls("agenda-item", `c-${v.kind}`, v.status === "pending" && "is-pending")} onClick={() => onVisit(v)}>
        <span class="agenda-time">{v.start ?? t("cal.allDay")}</span>
        <span class="agenda-text">
          <span class="agenda-title">
            {visitEmoji(v)} {v.name}
            {v.kind === "visit" && v.partySize > 1 ? ` (${v.partySize})` : ""}
          </span>
          {(v.status === "pending" || v.bring) && (
            <span class="agenda-sub">{v.status === "pending" ? t("status.pending") : v.bring}</span>
          )}
        </span>
      </button>
    );
  }
  const s = entry.s;
  return (
    <button type="button" class={cls("agenda-item", "is-slot", `c-${s.kind}`)} onClick={() => onSlot?.(s)}>
      <span class="agenda-time">{s.start}</span>
      <span class="agenda-text">
        <span class="agenda-title">{s.kind === "meal" ? t("cal.slotMealFree") : t("cal.slotFree")}</span>
        <span class="agenda-sub">{timeRange(s.start, s.end)}</span>
      </span>
    </button>
  );
}

export function VisitRow({ visit: v, today, onClick }: { visit: Visit; today: string; onClick: () => void }) {
  return (
    <button type="button" class="visit-row" onClick={onClick}>
      <span class={`visit-icon k-${v.kind}`} aria-hidden="true">
        {visitEmoji(v)}
      </span>
      <span class="visit-main">
        <span class="visit-name">
          {v.name}
          {v.kind === "visit" && v.partySize > 1 && <span class="muted"> · {tn("common.persons", v.partySize)}</span>}
        </span>
        <span class="visit-when">
          {v.date
            ? `${relDay(v.date, today)}${v.start ? `, ${timeRange(v.start, v.end)}` : ""}`
            : `${t("visits.suggests")} ${v.proposals.map((p) => dayShort(p.date)).join(" · ")}`}
        </span>
        {(v.message || v.bring) && <span class="visit-msg">{v.bring ? `🍲 ${v.bring}` : t("common.quote", { text: v.message })}</span>}
      </span>
      <StatusBadge status={v.status} />
    </button>
  );
}

export function DueBadge({ date, today, done }: { date: string; today: string; done?: boolean }) {
  const overdue = !done && date < today;
  return (
    <span class={cls("pill", overdue && "pill-danger", !done && date === today && "pill-warn")}>
      <Icon name="clock" size={12} /> {overdue ? `${relDay(date, today)} · ${t("item.overdue")}` : relDay(date, today)}
    </span>
  );
}

/** "Windeln kaufen #dm @Mama !" → title, tags, assignee, priority (and a pasted link). */
export function parseQuickAdd(text: string, users: User[]) {
  let s = ` ${text} `;
  const tags: string[] = [];
  s = s.replace(/\s#([\p{L}\p{N}_-]{1,32})(?=\s)/gu, (_, tag: string) => {
    tags.push(tag);
    return " ";
  });
  let assigneeId: number | null = null;
  s = s.replace(/\s@([\p{L}\p{N}._-]{1,32})(?=\s)/gu, (match, name: string) => {
    const low = name.toLowerCase();
    const user = users.find((u) => u.username === low || u.displayName.toLowerCase().startsWith(low));
    if (!user) return match;
    assigneeId = user.id;
    return " ";
  });
  let priority = 0;
  s = s.replace(/\s!(?=\s)/g, () => {
    priority = 1;
    return " ";
  });
  let url = "";
  s = s.replace(/\s(https?:\/\/\S+)(?=\s)/, (_, u: string) => {
    url = u;
    return " ";
  });
  let title = s.replace(/\s+/g, " ").trim();
  if (!title && url) title = hostOf(url);
  return { title, tags, assigneeId: assigneeId as number | null, priority, url };
}
