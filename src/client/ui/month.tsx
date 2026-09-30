// Calendar grids (weeks start on Monday): a classic month view and a rolling "next weeks" view.
import type { ComponentChildren } from "preact";
import { addDays, addMonths, daysInMonth, weekday } from "../../shared/dates";
import { dayLong, dayMonth, monthTitle, weekdayNames } from "../lib/format";
import { t } from "../lib/i18n";
import { IconButton, cls } from "./base";

/** First and last date shown in the grid of a month. */
export function gridRange(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const from = addDays(first, -weekday(first));
  const cells = Math.ceil((weekday(first) + daysInMonth(y, m)) / 7) * 7;
  return { from, to: addDays(from, cells - 1) };
}

/** Monday of the week that contains `date`. */
export const weekStart = (date: string) => addDays(date, -weekday(date));

interface DayProps {
  today: string;
  selected?: string | null;
  onSelect: (date: string) => void;
  renderDay?: (date: string) => ComponentChildren;
  dayClass?: (date: string) => string | false | undefined;
  large?: boolean;
  actions?: ComponentChildren;
}

function Grid(props: DayProps & {
  title: string;
  days: string[];
  isOut: (d: string) => boolean;
  showMonthOnFirst?: boolean;
  canPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div class={cls("cal", props.large && "cal-lg")}>
      <div class="cal-head">
        <h3 class="cal-title">{props.title}</h3>
        <div class="cal-nav">
          {props.actions}
          <IconButton icon="chevronLeft" label={props.prevLabel} disabled={!props.canPrev} onClick={props.onPrev} />
          <IconButton icon="chevronRight" label={props.nextLabel} onClick={props.onNext} />
        </div>
      </div>
      <div class="cal-grid">
        {weekdayNames().map((w) => (
          <div class="cal-wd" key={w}>
            {w}
          </div>
        ))}
        {props.days.map((d) => {
          const monthStart = props.showMonthOnFirst && d.endsWith("-01");
          return (
            <button
              type="button"
              key={d}
              class={cls(
                "cal-day",
                props.isOut(d) && "is-out",
                d === props.today && "is-today",
                d < props.today && "is-past",
                d === props.selected && "is-selected",
                props.dayClass?.(d),
              )}
              aria-pressed={d === props.selected}
              aria-label={dayLong(d)}
              onClick={() => props.onSelect(d)}
            >
              <span class={cls("cal-num", monthStart && "cal-num-month")}>{monthStart ? dayMonth(d) : Number(d.slice(8))}</span>
              {props.renderDay && <span class="cal-marks">{props.renderDay(d)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MonthGrid(props: DayProps & { month: string; onMonth: (month: string) => void; minMonth?: string }) {
  const { from, to } = gridRange(props.month);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <Grid
      {...props}
      title={monthTitle(props.month)}
      days={days}
      isOut={(d) => d.slice(0, 7) !== props.month}
      canPrev={!props.minMonth || props.month > props.minMonth}
      onPrev={() => props.onMonth(addMonths(props.month, -1))}
      onNext={() => props.onMonth(addMonths(props.month, 1))}
      prevLabel={t("common.prevMonth")}
      nextLabel={t("common.nextMonth")}
    />
  );
}

/** A rolling window of whole weeks – guests always see what's coming up, never a half-past month. */
export function WeeksGrid(props: DayProps & { start: string; weeks: number; onStart: (start: string) => void; minStart: string }) {
  const days = Array.from({ length: props.weeks * 7 }, (_, i) => addDays(props.start, i));
  const step = props.weeks * 7;
  return (
    <Grid
      {...props}
      title={`${dayMonth(days[0])} – ${dayMonth(days[days.length - 1])}`}
      days={days}
      isOut={() => false}
      showMonthOnFirst
      canPrev={props.start > props.minStart}
      onPrev={() => props.onStart(addDays(props.start, -step) < props.minStart ? props.minStart : addDays(props.start, -step))}
      onNext={() => props.onStart(addDays(props.start, step))}
      prevLabel={t("common.prevWeeks")}
      nextLabel={t("common.nextWeeks")}
    />
  );
}
