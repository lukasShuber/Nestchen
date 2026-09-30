// Private lists: to-dos, shopping, wishlists (with reservations), contacts, gifts and notes.
import { useState } from "preact/hooks";
import { zonedNow } from "../../shared/dates";
import { LIST_KINDS } from "../../shared/types";
import type { Claim, Item, List, ListKind, TagGroup } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { t, tn } from "../lib/i18n";
import { hostOf, phoneDigits, safeUrl, telUrl, whatsappUrl } from "../lib/links";
import { Link, navigate } from "../lib/router";
import { store } from "../lib/storage";
import {
  Avatar,
  Button,
  Check,
  Chip,
  Empty,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Select,
  Stepper,
  Switch,
  Textarea,
  cls,
} from "../ui/base";
import { Icon } from "../ui/icons";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { DueBadge, KIND_EMOJI, Page, parseQuickAdd } from "./common";
import { AttrChips, AttrFilterBar, AttrPills, matches, todoOrder } from "./todoTags";
import type { Filter } from "./todoTags";
import { useFamily } from "./context";

export function ListsPage() {
  const { data, error, reload } = useLoad(() => api<{ lists: List[] }>("/admin/lists"), []);
  const [creating, setCreating] = useState(false);
  return (
    <Page
      title={t("lists.title")}
      actions={
        <Button icon="plus" onClick={() => setCreating(true)}>
          {t("lists.new")}
        </Button>
      }
    >
      {error ? (
        <ErrorBox error={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <div class="list-grid">
          {data.lists.map((l) => (
            <Link key={l.id} href={`/family/lists/${l.id}`} class="card list-card">
              <span class="list-emoji" aria-hidden="true">
                {l.emoji || KIND_EMOJI[l.kind]}
              </span>
              <span class="list-text">
                <span class="list-title">{l.title}</span>
                <span class="muted small">
                  {t(`lists.kind.${l.kind}`)} ·{" "}
                  {l.kind === "contacts" || l.kind === "notes" ? tn("lists.entries", l.total) : t("lists.open", { n: l.open })}
                </span>
              </span>
              {l.isPublic && <span class="badge badge-public">🌍 {t("lists.public")}</span>}
            </Link>
          ))}
          <button type="button" class="card list-card list-card-new" onClick={() => setCreating(true)}>
            <span class="list-emoji" aria-hidden="true">
              ＋
            </span>
            <span class="list-title">{t("lists.new")}</span>
          </button>
        </div>
      )}
      <ListSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          reload();
          if (id) navigate(`/family/lists/${id}`);
        }}
      />
    </Page>
  );
}

// ---------------------------------------------------------------- one list

const CHECKABLE: ListKind[] = ["todo", "shopping", "gifts"];

function sortItems(kind: ListKind, items: Item[], groups: TagGroup[], today: string): Item[] {
  const byPos = (a: Item, b: Item) => a.position - b.position || a.id - b.id;
  const list = [...items];
  if (kind === "todo") return list.sort(todoOrder(groups, today));
  if (kind === "wishlist") return list.sort((a, b) => Number(a.done) - Number(b.done) || b.priority - a.priority || byPos(a, b));
  if (kind === "contacts") return list.sort((a, b) => a.title.localeCompare(b.title));
  return list.sort((a, b) => Number(a.done) - Number(b.done) || byPos(a, b));
}

export function ListPage({ id }: { id: number }) {
  const { settings } = useFamily();
  const groups = settings.todoTags;
  const { data, error, reload, setData } = useLoad(() => api<{ list: List; items: Item[] }>(`/admin/lists/${id}`), [id]);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilterState] = useState<Filter>(() => store.get<Filter>(`nest.filter.${id}`, {}));
  const setFilter = (f: Filter) => {
    setFilterState(f);
    store.set(`nest.filter.${id}`, f);
  };
  const [editing, setEditing] = useState<Item | null>(null);
  const [editList, setEditList] = useState(false);
  const today = zonedNow(settings.timezone).date;

  if (error) {
    return (
      <Page back="/family/lists" title={t("lists.title")}>
        <ErrorBox error={errorText(error)} onRetry={reload} />
      </Page>
    );
  }
  if (!data) return <Loading />;
  const { list, items } = data;
  const kindLabel = t(`lists.kind.${list.kind}`);
  const showKind = !list.title.toLowerCase().includes(kindLabel.toLowerCase());
  const hasDone = list.kind !== "contacts" && list.kind !== "notes";
  const doneCount = items.filter((i) => i.done).length;
  const tags = [...new Map(items.flatMap((i) => i.tags).map((tg) => [tg.toLowerCase(), tg])).values()].sort();
  const isTodo = list.kind === "todo";
  const activeFilter = isTodo ? filter : {};
  const visible = sortItems(
    list.kind,
    items.filter(
      (i) =>
        (showDone || !i.done || !hasDone) &&
        (!tag || i.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) &&
        matches(i.attrs, groups, activeFilter),
    ),
    groups,
    today,
  );
  const filtering = isTodo && Object.keys(filter).length > 0;
  const tagChips = tags.length > 0 && (
    <div class="chips" role="group" aria-label={t("item.tags")}>
      <Chip class="chip-all" active={!tag} onClick={() => setTag(null)}>
        {t("common.all")}
      </Chip>
      {tags.map((tg) => {
        const on = tag?.toLowerCase() === tg.toLowerCase();
        return (
          <Chip key={tg} active={on} onClick={() => setTag(on ? null : tg)}>
            #{tg}
          </Chip>
        );
      })}
    </div>
  );

  const add = async (e: Event) => {
    e.preventDefault();
    const parsed = parseQuickAdd(text, isTodo ? groups : []);
    if (!parsed.title) return;
    setAdding(true);
    try {
      const body: Record<string, unknown> = { title: parsed.title, tags: parsed.tags, url: parsed.url };
      if (isTodo) body.attrs = parsed.attrs;
      else if (parsed.important) body.priority = 1;
      const r = await api<{ item: Item }>(`/admin/lists/${id}/items`, { body });
      setData({ ...data, items: [...items, r.item] });
      setText("");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (item: Item) => {
    const done = !item.done;
    setData({ ...data, items: items.map((i) => (i.id === item.id ? { ...i, done } : i)) });
    try {
      await api(`/admin/items/${item.id}`, { method: "PATCH", body: { done } });
    } catch (err) {
      toast(errorText(err), "error");
      reload();
    }
  };

  const clearDone = async () => {
    if (!(await confirmDialog(t("lists.clearDoneConfirm"), { danger: true }))) return;
    await api(`/admin/lists/${id}/clear-done`, { body: {} }).catch((err) => toast(errorText(err), "error"));
    reload();
  };

  return (
    <Page
      back="/family/lists"
      title={
        <>
          <span aria-hidden="true">{list.emoji || KIND_EMOJI[list.kind]}</span> {list.title}
        </>
      }
      subtitle={
        (showKind || list.isPublic) && (
          <>
            {showKind && kindLabel}
            {list.isPublic && <span class="badge badge-public">🌍 {t("lists.publicHint")}</span>}
          </>
        )
      }
      actions={<IconButton icon="edit" label={t("lists.editList")} onClick={() => setEditList(true)} />}
    >
      <form class="quick-add quick-add-lg" onSubmit={add}>
        <Input
          value={text}
          onValue={setText}
          placeholder={list.kind === "contacts" ? `${t("item.name")} …` : t("lists.quickAddPh")}
          aria-label={t("item.new")}
        />
        <Button type="submit" icon="plus" busy={adding}>
          {t("common.add")}
        </Button>
      </form>
      {isTodo && <p class="field-hint quick-hint">{t("lists.quickAddHint")}</p>}
      {isTodo && groups.length > 0 ? (
        <AttrFilterBar groups={groups} items={items.filter((i) => showDone || !i.done)} filter={filter} onChange={setFilter}>
          {tagChips && (
            <div class="attr-filter-row">
              <span class="attr-filter-label">{t("item.tags")}</span>
              {tagChips}
            </div>
          )}
        </AttrFilterBar>
      ) : (
        tagChips
      )}

      {visible.length ? (
        <div class={cls("card items", `items-${list.kind}`)}>
          {visible.map((item) => (
            <ItemRow key={item.id} item={item} list={list} groups={groups} today={today} onToggle={() => toggle(item)} onOpen={() => setEditing(item)} />
          ))}
        </div>
      ) : (
        <div class="card">
          <Empty emoji={list.emoji || KIND_EMOJI[list.kind]} title={items.length ? t("lists.emptyFilter") : t("lists.empty")}>
            {filtering && (
              <button type="button" class="text-btn center" onClick={() => setFilter({})}>
                {t("lists.clearFilter")}
              </button>
            )}
          </Empty>
        </div>
      )}

      {hasDone && doneCount > 0 && (
        <div class="row list-foot">
          <Button variant="ghost" size="sm" icon={showDone ? "chevronDown" : "check"} onClick={() => setShowDone(!showDone)}>
            {showDone ? t("lists.hideDone") : t("lists.showDone", { n: doneCount })}
          </Button>
          {showDone && CHECKABLE.includes(list.kind) && (
            <Button variant="ghost" size="sm" icon="trash" onClick={clearDone}>
              {t("lists.clearDone")}
            </Button>
          )}
        </div>
      )}

      <ItemSheet item={editing} list={list} onClose={() => setEditing(null)} onSaved={reload} />
      <ListSheet
        open={editList}
        list={list}
        onClose={() => setEditList(false)}
        onSaved={reload}
        onDeleted={() => navigate("/family/lists")}
      />
    </Page>
  );
}

function ItemRow({ item, list, groups, today, onToggle, onOpen }: { item: Item; list: List; groups: TagGroup[]; today: string; onToggle: () => void; onOpen: () => void }) {
  const { settings } = useFamily();
  const link = item.url ? safeUrl(item.url) : null;
  const open = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  if (list.kind === "contacts") {
    const phone = phoneDigits(item.phone, settings.phoneCc);
    return (
      <div class="item item-contact" role="button" tabIndex={0} onClick={onOpen} onKeyDown={open}>
        <Avatar user={{ displayName: item.title, color: "sky" }} size={38} />
        <div class="item-main">
          <div class="item-title">{item.title}</div>
          {(item.phone || item.notes) && <div class="item-sub">{[item.phone, item.notes].filter(Boolean).join(" · ")}</div>}
        </div>
        {phone && (
          <a class="icon-btn icon-btn-soft" href={telUrl(phone)} onClick={(e) => e.stopPropagation()} aria-label={t("visits.call")}>
            <Icon name="phone" />
          </a>
        )}
        {phone && phone.length > 7 && (
          <a
            class="icon-btn icon-btn-soft"
            href={whatsappUrl(phone, "")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("visits.whatsapp")}
          >
            <Icon name="chat" />
          </a>
        )}
      </div>
    );
  }

  if (list.kind === "notes") {
    return (
      <div class="item item-note" role="button" tabIndex={0} onClick={onOpen} onKeyDown={open}>
        <div class="item-main">
          <div class="item-title">{item.title}</div>
          {item.notes && <p class="item-notes">{item.notes}</p>}
          {(item.tags.length > 0 || link) && (
            <div class="item-meta">
              {item.tags.map((tg) => (
                <span class="tag" key={tg}>
                  #{tg}
                </span>
              ))}
              {link && <LinkTag url={link} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isTodo = list.kind === "todo";
  const taken = (item.claims ?? []).reduce((sum, c) => sum + c.quantity, 0);
  return (
    <div class={cls("item", item.done && "is-done", !isTodo && item.priority > 0 && "is-important")} role="button" tabIndex={0} onClick={onOpen} onKeyDown={open}>
      {CHECKABLE.includes(list.kind) && <Check checked={item.done} onChange={onToggle} label={item.title} />}
      <div class="item-main">
        <div class="item-title">
          {!isTodo && item.priority > 0 && <span class="prio">{list.kind === "wishlist" ? "♥" : "!"}</span>}
          {item.title}
          {item.quantity > 1 && list.kind !== "wishlist" && <span class="qty">×{item.quantity}</span>}
        </div>
        <div class="item-meta">
          {isTodo && <AttrPills attrs={item.attrs} groups={groups} />}
          {list.kind === "gifts" && item.person && <span>🎁 {item.person}</span>}
          {item.dueDate && <DueBadge date={item.dueDate} today={today} done={item.done} />}
          {list.kind === "wishlist" && (
            <span class={cls("pill", taken >= item.quantity && "pill-ok")}>{t("lists.reserved", { n: taken, total: item.quantity })}</span>
          )}
          {list.kind === "wishlist" && item.price && <span class="pill">{item.price}</span>}
          {list.kind === "wishlist" && item.done && <span class="pill">{t("lists.hidden")}</span>}
          {item.tags.map((tg) => (
            <span class="tag" key={tg}>
              #{tg}
            </span>
          ))}
          {link && <LinkTag url={link} />}
          {item.notes && list.kind !== "wishlist" && <span class="item-note-preview">{item.notes.split("\n")[0]}</span>}
        </div>
      </div>
    </div>
  );
}

function LinkTag({ url }: { url: string }) {
  return (
    <a class="tag-link" href={url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
      <Icon name="link" size={13} /> {hostOf(url)}
    </a>
  );
}

// ---------------------------------------------------------------- item editor

function ItemSheet({ item, list, onClose, onSaved }: { item: Item | null; list: List; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? item.title : t("item.edit")}>
      {item && <ItemForm key={item.id} item={item} list={list} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ItemForm({ item, list, onClose, onSaved }: { item: Item; list: List; onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const groups = settings.todoTags;
  const k = list.kind;
  const { data: all } = useLoad(() => api<{ lists: List[] }>("/admin/lists"), []);
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [url, setUrl] = useState(item.url);
  const [price, setPrice] = useState(item.price);
  const [quantity, setQuantity] = useState(item.quantity);
  const [priority, setPriority] = useState(item.priority > 0);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [attrs, setAttrs] = useState<Record<string, string>>(item.attrs ?? {});
  const [phone, setPhone] = useState(item.phone);
  const [person, setPerson] = useState(item.person);
  const [done, setDone] = useState(item.done);
  const [listId, setListId] = useState(String(item.listId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/items/${item.id}`, {
        method: "PATCH",
        body: {
          title,
          notes,
          url,
          price,
          quantity,
          priority,
          tags: tags.split(/[,#]/).map((s) => s.trim()).filter(Boolean),
          dueDate: dueDate || null,
          ...(k === "todo" ? { attrs } : {}),
          phone,
          person,
          done,
          listId: Number(listId),
        },
      });
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
    if (!(await confirmDialog(t("item.deleteConfirm"), { danger: true }))) return;
    try {
      await api(`/admin/items/${item.id}`, { method: "DELETE" });
      toast(t("common.deleted"));
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const fieldError = (f: string) => (error?.field === f ? errorText(error) : null);
  const titleLabel = k === "contacts" ? t("item.name") : k === "gifts" ? t("item.gift") : t("item.title");

  return (
    <form class="form" onSubmit={save}>
      <Field label={titleLabel} error={fieldError("title")}>
        <Input value={title} onValue={setTitle} required maxLength={200} />
      </Field>

      {k === "contacts" && (
        <Field label={t("item.phone")} error={fieldError("phone")}>
          <Input type="tel" value={phone} onValue={setPhone} maxLength={40} autoComplete="off" />
        </Field>
      )}
      {k === "gifts" && (
        <Field label={t("item.person")}>
          <Input value={person} onValue={setPerson} maxLength={80} />
        </Field>
      )}
      {k === "todo" &&
        groups.map((g) => (
          <Field group key={g.id} label={g.name}>
            <AttrChips
              group={g}
              value={attrs[g.id]}
              onChange={(v) => {
                const next = { ...attrs };
                if (v) next[g.id] = v;
                else delete next[g.id];
                setAttrs(next);
              }}
            />
          </Field>
        ))}
      {k === "todo" && (
        <Field label={t("item.due")}>
          <Input type="date" value={dueDate} onValue={setDueDate} />
        </Field>
      )}
      {(k === "wishlist" || k === "shopping") && (
        <div class="grid-2">
          <Field group label={t("item.quantity")}>
            <Stepper value={quantity} onChange={setQuantity} min={1} max={99} label={t("item.quantity")} />
          </Field>
          {k === "wishlist" && (
            <Field label={t("item.price")}>
              <Input value={price} onValue={setPrice} maxLength={40} placeholder="ca. 20 €" />
            </Field>
          )}
        </div>
      )}
      <Field label={t("item.notes")}>
        <Textarea value={notes} onValue={setNotes} rows={k === "notes" ? 8 : 3} maxLength={4000} />
      </Field>
      {k !== "gifts" && (
        <Field label={t("item.url")} error={fieldError("url")}>
          <Input type="url" value={url} onValue={setUrl} maxLength={2000} placeholder="https://…" />
        </Field>
      )}
      {k !== "contacts" && k !== "gifts" && (
        <Field label={t("item.tags")} hint={t("item.tagsHint")}>
          <Input value={tags} onValue={setTags} maxLength={300} />
        </Field>
      )}
      {k === "wishlist" && <Switch checked={priority} onChange={setPriority} label={t("item.favorite")} />}
      {k === "gifts" && <Switch checked={done} onChange={setDone} label={t("item.thanked")} />}
      {(k === "todo" || k === "shopping") && <Switch checked={done} onChange={setDone} label={t("item.done")} />}
      {k === "wishlist" && <Switch checked={done} onChange={setDone} label={t("item.notNeeded")} />}

      {k === "wishlist" && <ClaimsEditor item={item} onChanged={onSaved} />}

      {all && all.lists.length > 1 && (
        <Field label={t("item.move")}>
          <Select value={listId} onValue={setListId} options={all.lists.map((l) => ({ value: String(l.id), label: `${l.emoji || KIND_EMOJI[l.kind]} ${l.title}` }))} />
        </Field>
      )}

      {error && !["title", "url", "phone"].includes(error.field ?? "") && <ErrorBox error={errorText(error)} />}
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

/** Who reserved a wishlist item – with "received" and "thanked" ticks. */
function ClaimsEditor({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [claims, setClaims] = useState<Claim[]>(item.claims ?? []);
  const [name, setName] = useState("");

  const patch = async (c: Claim, body: Partial<Claim>) => {
    try {
      const r = await api<{ claim: Claim }>(`/admin/claims/${c.id}`, { method: "PATCH", body });
      setClaims(claims.map((x) => (x.id === c.id ? r.claim : x)));
      onChanged();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };
  const remove = async (c: Claim) => {
    if (!(await confirmDialog(t("claim.deleteConfirm"), { danger: true }))) return;
    await api(`/admin/claims/${c.id}`, { method: "DELETE" }).catch((err) => toast(errorText(err), "error"));
    setClaims(claims.filter((x) => x.id !== c.id));
    onChanged();
  };
  const add = async () => {
    if (!name.trim()) return;
    try {
      const r = await api<{ claim: Claim }>(`/admin/items/${item.id}/claims`, { body: { name, quantity: 1 } });
      setClaims([...claims, r.claim]);
      setName("");
      onChanged();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <div class="claims">
      <div class="field-label">{t("item.claims")}</div>
      {claims.length ? (
        claims.map((c) => (
          <div class="claim-row" key={c.id}>
            <div class="claim-main">
              <strong>{c.name}</strong>
              {c.quantity > 1 && ` ×${c.quantity}`}
              {c.message && <div class="muted small">{t("common.quote", { text: c.message })}</div>}
            </div>
            <Chip active={c.received} onClick={() => patch(c, { received: !c.received })}>
              📦 {t("claim.received")}
            </Chip>
            <Chip active={c.thanked} onClick={() => patch(c, { thanked: !c.thanked })}>
              💌 {t("claim.thanked")}
            </Chip>
            <IconButton icon="trash" label={t("common.delete")} onClick={() => remove(c)} size={18} />
          </div>
        ))
      ) : (
        <p class="muted small">{t("item.claimsNone")}</p>
      )}
      <div class="inline-add">
        <Input value={name} onValue={setName} placeholder={t("item.claimName")} maxLength={80} aria-label={t("item.claimName")} />
        <Button variant="secondary" size="sm" icon="plus" onClick={add}>
          {t("item.addClaim")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- list editor

const EMOJIS = ["✅", "🛒", "🎁", "📞", "🎀", "📝", "🍼", "🧸", "👶", "🩺", "🏠", "🧺", "💊", "🚗", "📦", "🌙", "⭐", "💛", "🧾", "📚"];

function ListSheet({ open, list, onClose, onSaved, onDeleted }: { open: boolean; list?: List; onClose: () => void; onSaved: (id?: number) => void; onDeleted?: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={list ? t("lists.editList") : t("lists.new")}>
      {open && <ListForm list={list} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />}
    </Sheet>
  );
}

function ListForm({ list, onClose, onSaved, onDeleted }: { list?: List; onClose: () => void; onSaved: (id?: number) => void; onDeleted?: () => void }) {
  const [title, setTitle] = useState(list?.title ?? "");
  const [kind, setKind] = useState<ListKind>(list?.kind ?? "todo");
  const [emoji, setEmoji] = useState(list?.emoji ?? "");
  const [isPublic, setIsPublic] = useState(list?.isPublic ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { title, kind, emoji: emoji || KIND_EMOJI[kind], isPublic };
      if (list) {
        await api(`/admin/lists/${list.id}`, { method: "PUT", body });
        onSaved();
      } else {
        const r = await api<{ id: number }>("/admin/lists", { body });
        onSaved(r.id);
      }
      toast(t("common.saved"));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!list || !(await confirmDialog(t("lists.deleteConfirm"), { danger: true }))) return;
    try {
      await api(`/admin/lists/${list.id}`, { method: "DELETE" });
      toast(t("common.deleted"));
      onClose();
      onDeleted?.();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <form class="form" onSubmit={save}>
      <Field label={t("lists.name")}>
        <Input value={title} onValue={setTitle} required maxLength={60} autoFocus={!list} />
      </Field>
      <Field label={t("lists.kind")}>
        <Select value={kind} onValue={setKind} options={LIST_KINDS.map((k) => ({ value: k, label: `${KIND_EMOJI[k]} ${t(`lists.kind.${k}`)}` }))} />
      </Field>
      <Field group label={t("lists.emoji")}>
        <div class="emoji-picker">
          {EMOJIS.map((e) => (
            <button type="button" key={e} class={cls("emoji-btn", (emoji || KIND_EMOJI[kind]) === e && "is-active")} onClick={() => setEmoji(e)} aria-pressed={emoji === e}>
              {e}
            </button>
          ))}
        </div>
      </Field>
      {kind === "wishlist" && <Switch checked={isPublic} onChange={setIsPublic} label={`🌍 ${t("lists.public")}`} hint={t("lists.publicHint")} />}
      {!!error && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        {list && (
          <Button variant="danger" icon="trash" onClick={remove}>
            {t("common.delete")}
          </Button>
        )}
        <span class="spacer" />
        <Button type="submit" busy={busy} icon="check">
          {list ? t("common.save") : t("common.create")}
        </Button>
      </SheetActions>
    </form>
  );
}
