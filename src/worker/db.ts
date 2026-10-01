// Database schema, settings and row mapping.
// The Worker creates and upgrades its own tables on the first request, so no
// command-line migration step is needed after deploying.
import { TEXT_KEYS } from "../shared/types";
import type {
  CalEvent,
  Claim,
  Feeding,
  Item,
  Lang,
  List,
  ListKind,
  Person,
  Pumping,
  Settings,
  Sleep,
  TagGroup,
  TagOption,
  Slot,
  SlotBooking,
  Texts,
  User,
  Visit,
} from "../shared/types";
import { parseJson } from "./util";

type Migration = string[] | ((db: D1Database) => Promise<void>);

const MIGRATIONS: Migration[] = [
  [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'sage',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
    `CREATE TABLE IF NOT EXISTS attempts (bucket TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS attempts_bucket ON attempts(bucket, at)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'visit',
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS slots_date ON slots(date, start_time)`,
    `CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'visit',
      source TEXT NOT NULL DEFAULT 'slot',
      slot_id INTEGER REFERENCES slots(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      party_size INTEGER NOT NULL DEFAULT 1,
      message TEXT NOT NULL DEFAULT '',
      bring TEXT NOT NULL DEFAULT '',
      proposals TEXT NOT NULL DEFAULT '[]',
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      reply TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'de',
      ip_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS visits_status ON visits(status, date)`,
    `CREATE INDEX IF NOT EXISTS visits_slot ON visits(slot_id)`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      date TEXT NOT NULL,
      end_date TEXT,
      start_time TEXT,
      end_time TEXT,
      location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      repeat TEXT NOT NULL DEFAULT 'none',
      repeat_until TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS events_date ON events(date)`,
    `CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'todo',
      emoji TEXT NOT NULL DEFAULT '',
      is_public INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      done INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER,
      due_date TEXT,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      phone TEXT NOT NULL DEFAULT '',
      person TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS items_list ON items(list_id)`,
    `CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      message TEXT NOT NULL DEFAULT '',
      received INTEGER NOT NULL DEFAULT 0,
      thanked INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS claims_item ON claims(item_id)`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('app_secret', lower(hex(randomblob(32))))`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('ics_token', lower(hex(randomblob(20))))`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS feedings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      method TEXT NOT NULL DEFAULT 'breast',
      side TEXT,
      amount_ml INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS feedings_started ON feedings(started_at)`,
  ],
  // v3: explicit to-do attributes (who / priority / custom). Old assignee + "!" are carried over
  // (and cleared, so running this step twice – e.g. from two Worker instances at once – changes nothing).
  async (db) => {
    try {
      await db.prepare("ALTER TABLE items ADD COLUMN attrs TEXT NOT NULL DEFAULT '{}'").run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
    const todo = "list_id IN (SELECT id FROM lists WHERE kind = 'todo')";
    await db.batch([
      db.prepare(
        `UPDATE items SET attrs = json_set(attrs, '$.who', 'u' || assignee_id), assignee_id = NULL WHERE assignee_id IS NOT NULL AND ${todo}`,
      ),
      db.prepare(`UPDATE items SET attrs = json_set(attrs, '$.prio', 'high'), priority = 0 WHERE priority > 0 AND ${todo}`),
    ]);
  },
  // v4: pumping and sleep trackers (same shape as feedings).
  [
    `CREATE TABLE IF NOT EXISTS pumpings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      side TEXT NOT NULL DEFAULT 'both',
      amount_ml INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pumpings_started ON pumpings(started_at)`,
    `CREATE TABLE IF NOT EXISTS sleeps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      kind TEXT NOT NULL DEFAULT 'nap',
      place TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sleeps_started ON sleeps(started_at)`,
  ],
  // v5: pausing a running session (pause start + time paused before).
  async (db) => {
    for (const table of ["feedings", "pumpings", "sleeps"]) {
      for (const column of ["paused_at INTEGER", "paused_ms INTEGER NOT NULL DEFAULT 0"]) {
        try {
          await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column}`).run();
        } catch (err) {
          if (!/duplicate column/i.test(String(err))) throw err;
        }
      }
    }
  },
  // v6: people not to forget (visits page).
  [
    `CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
];

let ready: Promise<void> | null = null;

/** Create or upgrade the schema once per Worker instance. */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function migrate(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first<{ value: string }>();
  const current = row ? Number(row.value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v];
    const setVersion = db
      .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(v + 1));
    if (typeof step === "function") {
      await step(db);
      await setVersion.run();
    } else {
      await db.batch([...step.map((sql) => db.prepare(sql)), setVersion]);
    }
  }
}

// ---------------------------------------------------------------- settings

const DEFAULT_TEXTS: Texts = {
  title: { de: "Schön, dass du vorbeischaust!", en: "So glad you stopped by!" },
  intro: {
    de: "Unser Baby ist da und wir finden gerade unseren neuen Rhythmus. Hier siehst du, wann ein Besuch gut passt, wie du uns mit Essen verwöhnen kannst und was wir noch gebrauchen können. Danke, dass ihr an uns denkt! 💛",
    en: "Our baby has arrived and we're still finding our new rhythm. Here you can see when a visit suits us, how to spoil us with a meal and what we could still use. Thank you for thinking of us! 💛",
  },
  visitRules: {
    de: "Bitte nur kommen, wenn ihr gesund seid 🤧\nVor dem Baby-Halten Hände waschen 🧼\nKurz & herzlich – etwa eine Stunde ⏱️\nKein Parfum, kein Rauch 🚭\nStatt Geschenken freuen wir uns riesig über Essen 🍲",
    en: "Please only come when you're healthy 🤧\nWash your hands before holding the baby 🧼\nShort & sweet – about an hour ⏱️\nNo perfume, no smoke 🚭\nInstead of gifts, we'd love a meal 🍲",
  },
  mealNotes: {
    de: "Am liebsten etwas zum Aufwärmen – gern in Dosen, die ein paar Tage bei uns bleiben dürfen. Klingel bitte nur kurz, falls das Baby schläft 😴",
    en: "Ideally something we can reheat – containers that can stay with us for a few days are perfect. Please ring briefly in case the baby is asleep 😴",
  },
  giftNotes: {
    de: "Hier steht, was uns wirklich noch hilft. Gebrauchtes ist herzlich willkommen! Bitte keine Kuscheltiere mehr – davon haben wir schon genug 🧸",
    en: "This is what would really still help us. Second-hand is very welcome! Please no more cuddly toys – we already have plenty 🧸",
  },
};

const DEFAULTS: Record<string, string> = {
  site_name: "Nestchen",
  default_lang: "de",
  timezone: "Europe/Berlin",
  phone_cc: "49",
  show_visits: "1",
  show_meals: "1",
  show_wishlist: "1",
  auto_confirm: "0",
  guest_code: "",
  ntfy_url: "",
  gcal_embed: "",
  birth_date: "",
};

export type SettingsMap = Record<string, string>;

export async function loadSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map: SettingsMap = { ...DEFAULTS };
  for (const r of results) map[r.key] = r.value;
  return map;
}

export const textKey = (key: string, lang: Lang) => `text_${key}_${lang}`;

export function texts(s: SettingsMap): Texts {
  const out = {} as Texts;
  for (const key of TEXT_KEYS) {
    out[key] = {
      de: s[textKey(key, "de")] ?? DEFAULT_TEXTS[key].de,
      en: s[textKey(key, "en")] ?? DEFAULT_TEXTS[key].en,
    };
  }
  return out;
}

export const lang = (s: SettingsMap): Lang => (s.default_lang === "en" ? "en" : "de");

export function settingsForAdmin(s: SettingsMap, users: User[]): Settings {
  return {
    siteName: s.site_name,
    defaultLang: lang(s),
    timezone: s.timezone,
    phoneCc: s.phone_cc,
    showVisits: s.show_visits === "1",
    showMeals: s.show_meals === "1",
    showWishlist: s.show_wishlist === "1",
    autoConfirm: s.auto_confirm === "1",
    guestCode: s.guest_code,
    ntfyUrl: s.ntfy_url,
    gcalEmbed: s.gcal_embed,
    birthDate: s.birth_date,
    icsToken: s.ics_token,
    texts: texts(s),
    todoTags: todoTagGroups(s, users),
  };
}

/** The to-do attributes – saved ones, or sensible defaults built from the accounts. */
export function todoTagGroups(s: SettingsMap, users: User[]): TagGroup[] {
  const saved = parseJson<TagGroup[] | null>(s.todo_tags, null);
  if (Array.isArray(saved)) return saved;
  const de = lang(s) === "de";
  const everyone: TagOption[] =
    users.length > 1
      ? [{ id: "both", label: users.length > 2 ? (de ? "Alle" : "Everyone") : de ? "Beide" : "Both", color: "lavender", users: users.map((u) => u.id) }]
      : [];
  return [
    {
      id: "who",
      name: de ? "Wer" : "Who",
      role: "who",
      options: [...users.map((u) => ({ id: `u${u.id}`, label: u.displayName, color: u.color, users: [u.id] })), ...everyone],
    },
    {
      id: "prio",
      name: de ? "Priorität" : "Priority",
      role: "priority",
      options: [
        { id: "high", label: de ? "Hoch" : "High", color: "red" },
        { id: "mid", label: de ? "Mittel" : "Medium", color: "butter" },
        { id: "low", label: de ? "Niedrig" : "Low", color: "gray" },
      ],
    },
  ];
}

export async function saveSettings(db: D1Database, entries: [string, string][]) {
  if (!entries.length) return;
  await db.batch(
    entries.map(([key, value]) =>
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key, value),
    ),
  );
}

// ---------------------------------------------------------------- default lists

interface SeedList {
  title: string;
  kind: ListKind;
  emoji: string;
  isPublic?: boolean;
  items?: { title: string; phone?: string; notes?: string }[];
}

const SEED_LISTS: Record<Lang, SeedList[]> = {
  de: [
    { title: "Wunschliste", kind: "wishlist", emoji: "🎁", isPublic: true },
    { title: "To-dos", kind: "todo", emoji: "✅" },
    { title: "Einkaufen", kind: "shopping", emoji: "🛒" },
    {
      title: "Wichtige Kontakte",
      kind: "contacts",
      emoji: "📞",
      items: [
        { title: "Kinderarzt / Kinderärztin" },
        { title: "Hebamme" },
        { title: "Kita" },
        { title: "Notruf", phone: "112", notes: "Rettungsdienst & Feuerwehr (EU-weit)" },
        { title: "Ärztlicher Bereitschaftsdienst", phone: "116117", notes: "Nachts & am Wochenende (Deutschland)" },
      ],
    },
    { title: "Geschenke & Danke", kind: "gifts", emoji: "🎀" },
  ],
  en: [
    { title: "Wishlist", kind: "wishlist", emoji: "🎁", isPublic: true },
    { title: "To-dos", kind: "todo", emoji: "✅" },
    { title: "Shopping", kind: "shopping", emoji: "🛒" },
    {
      title: "Important contacts",
      kind: "contacts",
      emoji: "📞",
      items: [
        { title: "Paediatrician" },
        { title: "Midwife" },
        { title: "Daycare (Kita)" },
        { title: "Emergency", phone: "112", notes: "Ambulance & fire brigade (EU-wide)" },
        { title: "Out-of-hours doctor", phone: "116117", notes: "Nights & weekends (Germany)" },
      ],
    },
    { title: "Gifts & thank-yous", kind: "gifts", emoji: "🎀" },
  ],
};

/** Create the starter lists once (only if there are no lists yet). */
export async function seedLists(db: D1Database, language: Lang) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM lists").first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;
  const now = Date.now();
  let position = 0;
  for (const list of SEED_LISTS[language]) {
    const res = await db
      .prepare(
        "INSERT INTO lists (title, kind, emoji, is_public, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(list.title, list.kind, list.emoji, list.isPublic ? 1 : 0, position++, now, now)
      .run();
    const listId = res.meta.last_row_id;
    if (list.items?.length) {
      await db.batch(
        list.items.map((item, i) =>
          db
            .prepare(
              "INSERT INTO items (list_id, title, phone, notes, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(listId, item.title, item.phone ?? "", item.notes ?? "", i, now, now),
        ),
      );
    }
  }
}

// ---------------------------------------------------------------- row mapping

type Row = Record<string, any>;

export const mapUser = (r: Row): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  color: r.color,
});

export const mapVisit = (r: Row): Visit => ({
  id: r.id,
  token: r.token,
  kind: r.kind,
  source: r.source,
  slotId: r.slot_id ?? null,
  status: r.status,
  name: r.name,
  contact: r.contact,
  partySize: r.party_size,
  message: r.message,
  bring: r.bring,
  proposals: parseJson(r.proposals, []),
  date: r.date ?? null,
  start: r.start_time ?? null,
  end: r.end_time ?? null,
  reply: r.reply,
  lang: r.lang === "en" ? "en" : "de",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapSlot = (r: Row, bookings: SlotBooking[] = []): Slot => ({
  id: r.id,
  kind: r.kind,
  date: r.date,
  start: r.start_time,
  end: r.end_time,
  capacity: r.capacity,
  note: r.note,
  bookings,
});

export const mapEvent = (r: Row): CalEvent => ({
  id: r.id,
  uid: r.uid,
  title: r.title,
  category: r.category,
  date: r.date,
  endDate: r.end_date ?? null,
  start: r.start_time ?? null,
  end: r.end_time ?? null,
  location: r.location,
  notes: r.notes,
  repeat: r.repeat,
  repeatUntil: r.repeat_until ?? null,
  createdBy: r.created_by ?? null,
});

export const mapList = (r: Row): List => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  emoji: r.emoji,
  isPublic: !!r.is_public,
  position: r.position,
  open: r.open ?? 0,
  total: r.total ?? 0,
});

export const mapItem = (r: Row): Item => ({
  id: r.id,
  listId: r.list_id,
  title: r.title,
  notes: r.notes,
  url: r.url,
  price: r.price,
  quantity: r.quantity,
  priority: r.priority,
  tags: parseJson(r.tags, []),
  attrs: parseJson(r.attrs, {}),
  done: !!r.done,
  dueDate: r.due_date ?? null,
  assigneeId: r.assignee_id ?? null,
  phone: r.phone,
  person: r.person,
  position: r.position,
  createdAt: r.created_at,
});

export const mapClaim = (r: Row): Claim => ({
  id: r.id,
  itemId: r.item_id,
  name: r.name,
  quantity: r.quantity,
  message: r.message,
  received: !!r.received,
  thanked: !!r.thanked,
  createdAt: r.created_at,
});

export const mapFeeding = (r: Row): Feeding => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? null,
  method: r.method,
  side: r.side ?? null,
  amountMl: r.amount_ml ?? null,
  notes: r.notes,
  createdBy: r.created_by ?? null,
  pausedAt: r.paused_at ?? null,
  pausedMs: r.paused_ms ?? 0,
});

export const mapPumping = (r: Row): Pumping => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? null,
  side: r.side,
  amountMl: r.amount_ml ?? null,
  notes: r.notes,
  createdBy: r.created_by ?? null,
  pausedAt: r.paused_at ?? null,
  pausedMs: r.paused_ms ?? 0,
});

export const mapPerson = (r: Row): Person => ({
  id: r.id,
  name: r.name,
  contact: r.contact,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
});

export const mapSleep = (r: Row): Sleep => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? null,
  kind: r.kind,
  place: r.place ?? null,
  notes: r.notes,
  createdBy: r.created_by ?? null,
  pausedAt: r.paused_at ?? null,
  pausedMs: r.paused_ms ?? 0,
});
