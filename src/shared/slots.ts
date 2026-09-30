// Turning "Sat + Sun, 15:00–17:00, next two weeks" into individual slots.
// Shared so the browser can preview exactly what the Worker will create.
import { addDays, diffDays, minToTime, timeToMin, weekday } from "./dates";

export interface SlotSpec {
  from: string;
  to: string;
  /** Monday = 0 … Sunday = 6; ignored when from === to */
  weekdays: number[];
  start: string;
  end: string;
  /** Split the time window into slots of this many minutes; 0 = one slot */
  split: number;
}

export const MAX_SLOTS_PER_BATCH = 300;

export function generateSlots(spec: SlotSpec): { date: string; start: string; end: string }[] {
  const out: { date: string; start: string; end: string }[] = [];
  const startMin = timeToMin(spec.start);
  const endMin = timeToMin(spec.end);
  if (endMin <= startMin || spec.to < spec.from) return out;
  const days = diffDays(spec.from, spec.to);
  const single = days === 0;
  for (let i = 0; i <= days && out.length <= MAX_SLOTS_PER_BATCH; i++) {
    const date = addDays(spec.from, i);
    if (!single && !spec.weekdays.includes(weekday(date))) continue;
    if (spec.split > 0) {
      for (let m = startMin; m + spec.split <= endMin; m += spec.split) {
        out.push({ date, start: minToTime(m), end: minToTime(m + spec.split) });
      }
    } else {
      out.push({ date, start: spec.start, end: spec.end });
    }
  }
  return out;
}
