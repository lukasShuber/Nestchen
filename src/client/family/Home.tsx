// Private home screen: what's next, open requests and to-dos at a glance.
import { useState } from "preact/hooks";
import { addDays, zonedNow } from "../../shared/dates";
import type { CalEvent, HomeData, Item, Visit } from "../../shared/types";
import { api, errorText } from "../lib/api";
import { babyAge, dayLong } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { t, tn } from "../lib/i18n";
import { Link } from "../lib/router";
import { Avatar, Button, Check, Empty, ErrorBox, IconButton, Input, Loading } from "../ui/base";
import { Icon } from "../ui/icons";
import { toast } from "../ui/toast";
import { EventSheet } from "./Calendar";
import type { EventSheetState } from "./Calendar";
import { Agenda, DueBadge, Page, VisitRow, buildAgenda, parseQuickAdd } from "./common";
import { useFamily } from "./context";
import { SlotsSheet, VisitSheet } from "./Visits";

export function Home() {
  const { me, users, settings, refreshBadges } = useFamily();
  const { data, error, reload, setData } = useLoad(() => api<HomeData>("/admin/home"), []);
  const [eventSheet, setEventSheet] = useState<EventSheetState>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [todo, setTodo] = useState("");
  const [adding, setAdding] = useState(false);

  const now = data?.now ?? zonedNow(settings.timezone);
  const hour = Number(now.time.slice(0, 2));
  const greeting =
    hour < 5 || hour >= 23
      ? t("home.night")
      : hour < 11
        ? t("home.morning", { name: me.displayName })
        : hour >= 18
          ? t("home.evening", { name: me.displayName })
          : t("home.hello", { name: me.displayName });
  const age = settings.birthDate ? babyAge(settings.birthDate, now.date) : "";

  const addTodo = async (e: Event) => {
    e.preventDefault();
    if (!data?.todoListId) return;
    const parsed = parseQuickAdd(todo, users);
    if (!parsed.title) return;
    setAdding(true);
    try {
      await api(`/admin/lists/${data.todoListId}/items`, { body: parsed });
      setTodo("");
      reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setAdding(false);
    }
  };

  const finishTodo = async (item: Item) => {
    if (!data) return;
    setData({ ...data, todos: data.todos.filter((x) => x.id !== item.id), openTodos: data.openTodos - 1 });
    try {
      await api(`/admin/items/${item.id}`, { method: "PATCH", body: { done: true } });
    } catch (err) {
      toast(errorText(err), "error");
      reload();
    }
  };

  const openEvent = (ev: CalEvent) => setEventSheet({ event: ev });

  return (
    <Page
      title={greeting}
      subtitle={
        <>
          <span>{dayLong(now.date)}</span>
          {age && <span class="age">🌙 {t("home.age", { age })}</span>}
        </>
      }
    >
      <div class="quick-row">
        <Button variant="soft" icon="plus" onClick={() => setEventSheet({ date: now.date })}>
          {t("home.quick.event")}
        </Button>
        <Button variant="soft" icon="visits" onClick={() => setSlotsOpen(true)}>
          {t("home.quick.slots")}
        </Button>
      </div>

      {error ? (
        <ErrorBox error={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <div class="home-grid">
          {data.pending.length > 0 && (
            <section class="card card-accent">
              <h2 class="card-title">
                <Icon name="inbox" /> {t("home.pending")} <span class="count">{data.pending.length}</span>
              </h2>
              <div class="stack">
                {data.pending.map((v) => (
                  <VisitRow key={v.id} visit={v} today={now.date} onClick={() => setVisit(v)} />
                ))}
              </div>
            </section>
          )}

          <section class="card">
            <h2 class="card-title">
              <Icon name="calendar" /> {t("home.next")}
            </h2>
            {(() => {
              const days = buildAgenda(data.events, data.visits, [], now.date, addDays(now.date, 6));
              return days.length ? (
                <Agenda days={days} today={now.date} onEvent={openEvent} onVisit={setVisit} />
              ) : (
                <Empty emoji="😴" title={t("home.nothingNext")} />
              );
            })()}
          </section>

          <section class="card">
            <h2 class="card-title">
              <Icon name="list" /> {t("home.todos")}
            </h2>
            {data.todoListId && (
              <form class="quick-add" onSubmit={addTodo}>
                <Input value={todo} onValue={setTodo} placeholder={t("home.todoPh")} aria-label={t("home.todoPh")} />
                <IconButton type="submit" icon="plus" label={t("common.add")} class="icon-btn-primary" disabled={adding} />
              </form>
            )}
            {data.todos.length ? (
              <ul class="todo-mini">
                {data.todos.map((item) => {
                  const who = users.find((u) => u.id === item.assigneeId);
                  return (
                    <li key={item.id}>
                      <Check checked={false} onChange={() => finishTodo(item)} label={item.title} />
                      <span class="todo-title">
                        {item.priority > 0 && <span class="prio">!</span>}
                        {item.title}
                      </span>
                      {item.dueDate && <DueBadge date={item.dueDate} today={now.date} />}
                      {who && <Avatar user={who} size={24} />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p class="muted">{t("home.todosEmpty")}</p>
            )}
            {data.todoListId && data.openTodos > data.todos.length && (
              <Link href={`/family/lists/${data.todoListId}`} class="text-link">
                {t("home.todosAll", { n: data.openTodos })} →
              </Link>
            )}
          </section>

          {data.thanksOpen > 0 && (
            <Link href="/family/thanks" class="card card-link">
              <span class="card-link-emoji" aria-hidden="true">
                🎀
              </span>
              <span>{tn("home.thanks", data.thanksOpen)}</span>
              <Icon name="chevronRight" />
            </Link>
          )}
        </div>
      )}

      <EventSheet state={eventSheet} onClose={() => setEventSheet(null)} onSaved={reload} />
      <VisitSheet
        visit={visit}
        onClose={() => setVisit(null)}
        onChanged={() => {
          reload();
          refreshBadges();
        }}
      />
      <SlotsSheet open={slotsOpen} onClose={() => setSlotsOpen(false)} onSaved={() => {}} />
    </Page>
  );
}
