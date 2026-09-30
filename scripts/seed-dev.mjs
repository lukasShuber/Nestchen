#!/usr/bin/env node
// Fills the LOCAL development database with demo data, so you can click around.
// It refuses to run against anything but localhost.
//
//   npm run dev        (terminal 1)
//   npm run seed       (terminal 2)
//
// Local demo logins afterwards: "papa" / "dev-password" and "mama" / "dev-password".

const BASE = process.env.SEED_URL ?? "http://localhost:5173";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  throw new Error(`Refusing to seed a non-local URL: ${BASE}`);
}
const SETUP_CODE = process.env.SETUP_CODE ?? "dev-setup-code"; // same as .dev.vars.example
const PAPA = { username: "papa", displayName: "Papa", password: "dev-password" };
const MAMA = { username: "mama", displayName: "Mama", password: "dev-password" };

let cookie = "";
async function call(path, body, method) {
  const verb = method ?? (body ? "POST" : "GET");
  const res = await fetch(`${BASE}/api${path}`, {
    method: verb,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.startsWith("nest=")) cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${verb} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// --- accounts
const state = await call("/auth/state");
if (!state.hasUsers) await call("/auth/setup", { ...PAPA, setupCode: SETUP_CODE, lang: "de" });
else await call("/auth/login", PAPA);
const { users } = await call("/admin/users");
if (!users.some((u) => u.username === MAMA.username)) await call("/admin/users", MAMA);
const all = (await call("/admin/users")).users;
const papa = all.find((u) => u.username === "papa");
const mama = all.find((u) => u.username === "mama");
await call("/admin/users/me", { color: "sage" }, "PATCH");
await call("/admin/settings", { birthDate: day(-23) }, "PUT");

// --- visiting times & meal train
await call("/admin/slots", { kind: "visit", from: day(1), to: day(21), weekdays: [5, 6], start: "15:00", end: "17:00", split: 60, capacity: 1, note: "Gern kurz – das Baby schläft oft 😴" });
await call("/admin/slots", { kind: "visit", from: day(1), to: day(14), weekdays: [2], start: "10:00", end: "11:30", split: 0, capacity: 2, note: "" });
await call("/admin/slots", { kind: "meal", from: day(1), to: day(14), weekdays: [0, 2, 4], start: "17:30", end: "19:00", split: 0, capacity: 1, note: "" });

const { slots } = await call("/public/slots");
const visitSlots = slots.filter((s) => s.kind === "visit");
const mealSlots = slots.filter((s) => s.kind === "meal");
const oma = await call("/public/requests", { kind: "visit", slotId: visitSlots[0].id, name: "Oma Erika & Opa Kurt", contact: "0171 5550123", partySize: 2, message: "Wir bringen Kuchen mit!", lang: "de" });
await call("/public/requests", { kind: "visit", slotId: visitSlots[2].id, name: "Jonas", contact: "jonas@example.com", partySize: 1, message: "", lang: "de" });
await call("/public/requests", { kind: "meal", slotId: mealSlots[1].id, name: "Tante Ina", contact: "0160 5550199", bring: "Kürbissuppe & Brot", lang: "de" });
await call("/public/requests", { kind: "visit", name: "Sarah & Tom", contact: "+44 7700 900123", partySize: 2, proposals: [{ date: day(9), start: "10:00", end: "11:30" }, { date: day(10) }], message: "We'd love to meet the little one!", lang: "en" });

const { visits } = await call("/admin/visits?scope=open");
const omaVisit = visits.find((v) => v.token === oma.token);
await call(`/admin/visits/${omaVisit.id}`, { status: "confirmed", reply: "Wir freuen uns sehr! 💛" }, "PATCH");

// --- appointments
const events = [
  { title: "U3 beim Kinderarzt", category: "doctor", date: day(2), start: "09:30", end: "10:15", location: "Praxis Dr. Sonnenschein", notes: "Gelbes Heft & Versichertenkarte mitnehmen" },
  { title: "Hebamme kommt", category: "doctor", date: day(1), start: "11:00", end: "11:45", repeat: "weekly", repeatUntil: day(29) },
  { title: "Elterngeld-Antrag abschicken", category: "admin", date: day(5) },
  { title: "Kita-Anmeldung: Frist", category: "admin", date: day(12) },
  { title: "Babyschwimmen", category: "family", date: day(8), start: "10:00", end: "10:45", repeat: "weekly", location: "Stadtbad" },
  { title: "Omas Geburtstag 🎂", category: "family", date: day(17) },
  { title: "Kita-Eingewöhnung", category: "kita", date: day(40), endDate: day(51) },
];
for (const e of events) await call("/admin/events", e);

// --- lists
const { lists } = await call("/admin/lists");
const byKind = (k) => lists.find((l) => l.kind === k).id;
const add = (list, item) => call(`/admin/lists/${list}/items`, item);

const wish = byKind("wishlist");
const bodys = await add(wish, { title: "Bodys Gr. 62, Langarm", quantity: 3, price: "ca. 8 € / Stück", tags: ["Kleidung"], priority: 1, notes: "Gern Bio-Baumwolle, neutral in der Farbe.", url: "https://www.example.com/bodys" });
await add(wish, { title: "Schlafsack 70 cm (TOG 2.5)", price: "ca. 40 €", tags: ["Schlafen"], url: "https://www.example.com/schlafsack" });
const books = await add(wish, { title: "Pappbilderbücher", quantity: 4, price: "ca. 10 €", tags: ["Bücher"], notes: "Kontrastreich oder mit Tieren 🐻" });
const musicBox = await add(wish, { title: "Spieluhr", price: "ca. 25 €", tags: ["Schlafen"] });
await add(wish, { title: "Gutschein für die Drogerie", quantity: 5, price: "beliebig", tags: ["Gutschein"], notes: "Windeln brauchen wir immer 😅" });
await add(wish, { title: "Babytrage (gern gebraucht)", price: "ca. 90 €", tags: ["Unterwegs"], priority: 1 });
await call(`/public/wishlist/${books.item.id}/claim`, { name: "Tante Ina", quantity: 2, message: "Freu mich schon aufs Vorlesen!" });
await call(`/public/wishlist/${musicBox.item.id}/claim`, { name: "Opa Kurt", quantity: 1 });
await call(`/public/wishlist/${bodys.item.id}/claim`, { name: "Familie Berger", quantity: 1 });

const todo = byKind("todo");
await add(todo, { title: "Elterngeld beantragen", dueDate: day(5), assigneeId: mama.id, priority: 1 });
await add(todo, { title: "U4-Termin beim Kinderarzt vereinbaren", dueDate: day(10), assigneeId: papa.id });
await add(todo, { title: "Dankeskarten bestellen", dueDate: day(-1), assigneeId: papa.id });
await add(todo, { title: "Hebamme wegen Rückbildungskurs fragen", assigneeId: mama.id });
await add(todo, { title: "Kita-Warteliste anrufen", tags: ["kita"], dueDate: day(3) });

const shop = byKind("shopping");
for (const title of ["Windeln Gr. 2", "Feuchttücher", "Stilleinlagen"]) await add(shop, { title, tags: ["dm"] });
await add(shop, { title: "Hafermilch", quantity: 2 });
const bread = await add(shop, { title: "Brot" });
await call(`/admin/items/${bread.item.id}`, { done: true }, "PATCH");

const contacts = (await call(`/admin/lists/${byKind("contacts")}`)).items;
const phones = { "Kinderarzt / Kinderärztin": "030 5550101", Hebamme: "0176 5550102", Kita: "030 5550103" };
for (const c of contacts) if (phones[c.title]) await call(`/admin/items/${c.id}`, { phone: phones[c.title] }, "PATCH");

await call("/admin/thanks/gifts", { title: "Selbstgestrickte Mütze", person: "Nachbarin Frau Kühn" });

console.log(`Seeded ${BASE} ✓  (log in at ${BASE}/family as papa / dev-password)`);
