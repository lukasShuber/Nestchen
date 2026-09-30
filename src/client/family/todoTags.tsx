// Explicit to-do attributes (who / priority / custom): pills, chip pickers, filters and sorting.
import type { ComponentChildren } from "preact";
import type { Item, TagGroup, TagOption } from "../../shared/types";
import { t } from "../lib/i18n";
import { cls } from "../ui/base";

export type Filter = Record<string, string>;

export const whoGroup = (groups: TagGroup[]) => groups.find((g) => g.role === "who");
export const prioGroup = (groups: TagGroup[]) => groups.find((g) => g.role === "priority");

const optionOf = (group: TagGroup, id: string | undefined): TagOption | undefined =>
  id ? group.options.find((o) => o.id === id) : undefined;

/** Position in the priority order (0 = most important); items without priority come last. */
export function prioRank(attrs: Record<string, string>, groups: TagGroup[]): number {
  const prio = prioGroup(groups);
  const i = prio ? prio.options.findIndex((o) => o.id === attrs[prio.id]) : -1;
  return i < 0 ? 99 : i;
}

/** Does a to-do pass the filter? Filtering by a person also shows options that include that person ("Beide"). */
export function matches(attrs: Record<string, string>, groups: TagGroup[], filter: Filter): boolean {
  for (const [groupId, optionId] of Object.entries(filter)) {
    if (!optionId) continue;
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;
    const value = attrs[groupId];
    if (value === optionId) continue;
    if (group.role === "who") {
      const wanted = optionOf(group, optionId)?.users ?? [];
      const has = optionOf(group, value)?.users ?? [];
      if (wanted.length && wanted.every((u) => has.includes(u))) continue;
    }
    return false;
  }
  return true;
}

/** Overdue first, then by priority, then by due date. */
export function todoOrder(groups: TagGroup[], today: string) {
  return (a: Item, b: Item) =>
    Number(a.done) - Number(b.done) ||
    Number(!!b.dueDate && b.dueDate < today) - Number(!!a.dueDate && a.dueDate < today) ||
    prioRank(a.attrs, groups) - prioRank(b.attrs, groups) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.position - b.position ||
    a.id - b.id;
}

/** Small coloured labels for the attributes a to-do has. */
export function AttrPills({ attrs, groups }: { attrs: Record<string, string>; groups: TagGroup[] }) {
  return (
    <>
      {groups.map((g) => {
        const o = optionOf(g, attrs[g.id]);
        return o ? (
          <span key={g.id} class={cls("attr-pill", `tc-${o.color}`)} title={g.name}>
            {o.label}
          </span>
        ) : null;
      })}
    </>
  );
}

/** Single-choice chip row; tapping the active chip again clears it (or selects "all" with allLabel). */
export function AttrChips({
  group,
  value,
  onChange,
  counts,
  allLabel,
}: {
  group: TagGroup;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  counts?: Record<string, number>;
  allLabel?: string;
}) {
  return (
    <div class="chips attr-chips" role="group" aria-label={group.name}>
      {allLabel && (
        <button type="button" class={cls("chip", "chip-all", !value && "is-active")} aria-pressed={!value} onClick={() => onChange(undefined)}>
          {allLabel}
        </button>
      )}
      {group.options.map((o) => (
        <button
          type="button"
          key={o.id}
          class={cls("chip", "attr-chip", `tc-${o.color}`, value === o.id && "is-active")}
          aria-pressed={value === o.id}
          onClick={() => onChange(value === o.id ? undefined : o.id)}
        >
          <span class="attr-dot" aria-hidden="true" />
          {o.label}
          {counts && <span class="chip-count">{counts[o.id] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

/** One chip row per attribute above a to-do list, with live counts; children become extra rows. */
export function AttrFilterBar({
  groups,
  items,
  filter,
  onChange,
  children,
}: {
  groups: TagGroup[];
  items: Item[];
  filter: Filter;
  onChange: (f: Filter) => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="attr-filter">
      {groups.map((g) => {
        const counts: Record<string, number> = {};
        for (const o of g.options) {
          const probe = { ...filter, [g.id]: o.id };
          counts[o.id] = items.filter((i) => matches(i.attrs, groups, probe)).length;
        }
        return (
          <div class="attr-filter-row" key={g.id}>
            <span class="attr-filter-label">{g.name}</span>
            <AttrChips
              group={g}
              value={filter[g.id]}
              counts={counts}
              allLabel={t("common.all")}
              onChange={(v) => {
                const next = { ...filter };
                if (v) next[g.id] = v;
                else delete next[g.id];
                onChange(next);
              }}
            />
          </div>
        );
      })}
      {children}
    </div>
  );
}
