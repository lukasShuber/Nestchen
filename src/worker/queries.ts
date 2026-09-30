// Queries shared by the private API and the calendar feeds.
import { addDays, diffDays, occurrences } from "../shared/dates";
import type { Occurrence, Slot, SlotBooking } from "../shared/types";
import { mapEvent, mapSlot } from "./db";

/** All event occurrences (repeating events expanded) overlapping [from, to]. */
export async function occurrencesBetween(db: D1Database, from: string, to: string): Promise<Occurrence[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM events
       WHERE (repeat = 'none' AND date <= ? AND COALESCE(end_date, date) >= ?)
          OR (repeat != 'none' AND date <= ? AND (repeat_until IS NULL OR repeat_until >= ?))`,
    )
    .bind(to, from, to, addDays(from, -366))
    .all<Record<string, any>>();
  const out: Occurrence[] = [];
  for (const row of results) {
    const ev = mapEvent(row);
    const span = ev.endDate ? diffDays(ev.date, ev.endDate) : 0;
    for (const occ of occurrences(ev, from, to)) {
      out.push({ ...ev, occ, occEnd: span ? addDays(occ, span) : null });
    }
  }
  return out.sort(
    (a, b) =>
      a.occ.localeCompare(b.occ) ||
      (a.start ? 1 : 0) - (b.start ? 1 : 0) ||
      (a.start ?? "").localeCompare(b.start ?? "") ||
      a.id - b.id,
  );
}

/** Slots in [from, to] with the guests who requested or booked them. */
export async function slotsBetween(db: D1Database, from: string, to: string): Promise<Slot[]> {
  const [slots, bookings] = await db.batch<Record<string, any>>([
    db.prepare("SELECT * FROM slots WHERE date >= ? AND date <= ? ORDER BY date, start_time").bind(from, to),
    db
      .prepare(
        `SELECT v.id, v.slot_id, v.name, v.status, v.party_size FROM visits v JOIN slots s ON s.id = v.slot_id
         WHERE s.date >= ? AND s.date <= ? AND v.status IN ('pending', 'confirmed') ORDER BY v.created_at`,
      )
      .bind(from, to),
  ]);
  const bySlot = new Map<number, SlotBooking[]>();
  for (const b of bookings.results) {
    const list = bySlot.get(b.slot_id) ?? [];
    list.push({ id: b.id, name: b.name, status: b.status, partySize: b.party_size });
    bySlot.set(b.slot_id, list);
  }
  return slots.results.map((r) => mapSlot(r, bySlot.get(r.id) ?? []));
}
