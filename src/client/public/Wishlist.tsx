// Public: the wishlist, where guests can reserve gifts so nothing is bought twice.
import { useState } from "preact/hooks";
import type { PublicInfo, PublicWishItem, PublicWishlist } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { t } from "../lib/i18n";
import { hostOf, safeUrl } from "../lib/links";
import { store } from "../lib/storage";
import { Button, Chip, Empty, ErrorBox, Field, Input, Loading, Stepper, Textarea, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import { Sheet, SheetActions } from "../ui/sheet";
import { toast } from "../ui/toast";
import { pickText } from "./PublicApp";

interface SavedClaim {
  token: string;
  itemId: number;
  quantity: number;
}

const left = (i: PublicWishItem) => Math.max(0, i.quantity - i.taken);

export function WishlistSection({ info }: { info: PublicInfo }) {
  const { data, error, reload } = useLoad(() => api<{ lists: PublicWishlist[] }>("/public/wishlist"), []);
  const [tag, setTag] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<PublicWishItem | null>(null);
  const [mine, setMine] = useState<SavedClaim[]>(() => store.get("nest.claims", []));
  const notes = pickText(info.texts?.giftNotes);

  const saveMine = (list: SavedClaim[]) => {
    setMine(list);
    store.set("nest.claims", list);
  };

  const undo = async (item: PublicWishItem) => {
    for (const c of mine.filter((m) => m.itemId === item.id)) {
      try {
        await api(`/public/claims/${c.token}`, { method: "DELETE" });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          toast(errorText(err), "error");
          return;
        }
      }
    }
    saveMine(mine.filter((m) => m.itemId !== item.id));
    toast(t("pub.wish.undone"));
    reload();
  };

  const lists = (data?.lists ?? []).filter((l) => l.items.length);
  const allItems = lists.flatMap((l) => l.items);
  const tags = [...new Map(allItems.flatMap((i) => i.tags).map((tg) => [tg.toLowerCase(), tg])).values()].sort((a, b) =>
    a.localeCompare(b),
  );
  const matches = (i: PublicWishItem) => !tag || i.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
  // Still available first, then top wishes.
  const order = (a: PublicWishItem, b: PublicWishItem) =>
    Number(left(a) === 0) - Number(left(b) === 0) || b.priority - a.priority;

  return (
    <section class="section" id="wuensche" aria-labelledby="wish-title">
      <div class="section-head">
        <h2 id="wish-title">🎁 {t("pub.wish.title")}</h2>
        {notes && <p class="lead">{notes}</p>}
      </div>
      {tags.length > 1 && (
        <div class="chips" role="group">
          <Chip active={!tag} onClick={() => setTag(null)}>
            {t("common.all")}
          </Chip>
          {tags.map((tg) => (
            <Chip key={tg} active={tag?.toLowerCase() === tg.toLowerCase()} onClick={() => setTag(tg)}>
              #{tg}
            </Chip>
          ))}
        </div>
      )}
      {error ? (
        <ErrorBox error={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : !allItems.length ? (
        <div class="card">
          <Empty emoji="🧸" title={t("pub.wish.empty")} />
        </div>
      ) : (
        lists.map((l) => {
          const items = l.items.filter(matches).sort(order);
          if (!items.length) return null;
          return (
            <div class="wish-group" key={l.id}>
              {lists.length > 1 && (
                <h3 class="group-title">
                  {l.emoji} {l.title}
                </h3>
              )}
              <div class="wish-grid">
                {items.map((i) => (
                  <WishCard
                    key={i.id}
                    item={i}
                    mine={mine.some((m) => m.itemId === i.id)}
                    onClaim={() => setClaiming(i)}
                    onUndo={() => undo(i)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
      <Sheet open={!!claiming} onClose={() => setClaiming(null)} title={claiming ? `🎁 ${claiming.title}` : ""}>
        {claiming && (
          <ClaimForm
            item={claiming}
            onDone={(claim) => {
              saveMine([...mine, claim]);
              setClaiming(null);
              toast(t("pub.wish.claimed"));
              reload();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function WishCard({ item, mine, onClaim, onUndo }: { item: PublicWishItem; mine: boolean; onClaim: () => void; onUndo: () => void }) {
  const remaining = left(item);
  const link = item.url ? safeUrl(item.url) : null;
  return (
    <article class={cls("wish", !remaining && !mine && "is-full", item.priority > 0 && "is-fav", mine && "is-mine")}>
      <div class="wish-head">
        <h3 class="wish-title">{item.title}</h3>
        {item.priority > 0 && (
          <span class="fav" title={t("pub.wish.favorite")} aria-label={t("pub.wish.favorite")}>
            ♥
          </span>
        )}
      </div>
      {item.notes && <p class="wish-notes">{item.notes}</p>}
      {(item.price || item.quantity > 1 || item.tags.length > 0) && (
        <div class="wish-meta">
          {item.price && <span class="pill">{item.price}</span>}
          {item.quantity > 1 && <span class="pill">{t("pub.wish.left", { n: remaining, total: item.quantity })}</span>}
          {item.tags.map((tg) => (
            <span class="tag" key={tg}>
              #{tg}
            </span>
          ))}
        </div>
      )}
      <div class="wish-foot">
        {link && (
          <a class="text-link" href={link} target="_blank" rel="noopener noreferrer nofollow" title={hostOf(link)}>
            <Icon name="external" size={15} /> {t("pub.wish.example")}
          </a>
        )}
        <div class="wish-action">
          {mine ? (
            <>
              <span class="badge badge-ok">{t("pub.wish.yours")}</span>
              <button type="button" class="text-btn" onClick={onUndo}>
                {t("pub.wish.undo")}
              </button>
            </>
          ) : remaining ? (
            <Button size="sm" icon="gift" onClick={onClaim}>
              {t("pub.wish.give")}
            </Button>
          ) : (
            <span class="badge">{t("pub.wish.reserved")}</span>
          )}
        </div>
      </div>
    </article>
  );
}

function ClaimForm({ item, onDone }: { item: PublicWishItem; onDone: (claim: SavedClaim) => void }) {
  const max = Math.max(1, left(item));
  const [name, setName] = useState(() => store.get("nest.guestName", ""));
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>(`/public/wishlist/${item.id}/claim`, {
        body: { name, quantity, message, website },
      });
      store.set("nest.guestName", name);
      onDone({ token: r.token, itemId: item.id, quantity });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={submit}>
      {item.notes && <p class="muted">{item.notes}</p>}
      <Field label={t("pub.wish.claimName")} hint={t("pub.wish.claimNameHint")} error={error?.field === "name" ? errorText(error) : null}>
        <Input value={name} onValue={setName} required maxLength={80} autoComplete="name" autoFocus />
      </Field>
      {max > 1 && (
        <Field group label={t("pub.wish.claimQty")}>
          <Stepper value={quantity} onChange={setQuantity} min={1} max={max} label={t("pub.wish.claimQty")} />
        </Field>
      )}
      <Field label={<>{t("pub.wish.claimMessage")} <span class="opt">({t("common.optional")})</span></>}>
        <Textarea value={message} onValue={setMessage} rows={2} maxLength={500} />
      </Field>
      <div class="hp" aria-hidden="true">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onInput={(e) => setWebsite(e.currentTarget.value)} />
        </label>
      </div>
      {error && error.field !== "name" && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        <Button type="submit" icon="gift" busy={busy} block>
          {t("pub.wish.claimSubmit")}
        </Button>
      </SheetActions>
    </form>
  );
}
