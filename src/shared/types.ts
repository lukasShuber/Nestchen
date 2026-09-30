// Shapes of the JSON exchanged between the Worker API and the browser.
import type { Repeat } from "./dates";

export type Lang = "de" | "en";
export type SlotKind = "visit" | "meal";
export type VisitStatus = "pending" | "confirmed" | "declined" | "cancelled";
export type VisitSource = "slot" | "proposal" | "manual";
export type Category = "doctor" | "kita" | "admin" | "family" | "other";
export type ListKind = "todo" | "shopping" | "wishlist" | "contacts" | "gifts" | "notes";

export const CATEGORIES: readonly Category[] = ["doctor", "kita", "admin", "family", "other"];
export const LIST_KINDS: readonly ListKind[] = ["todo", "shopping", "wishlist", "contacts", "gifts", "notes"];
export const USER_COLORS = ["sage", "peach", "sky", "lavender", "butter", "rose"] as const;
export type UserColor = (typeof USER_COLORS)[number];

/** Texts shown on the public page, each available in German and English. */
export const TEXT_KEYS = ["title", "intro", "visitRules", "mealNotes", "giftNotes"] as const;
export type TextKey = (typeof TEXT_KEYS)[number];
export type Texts = Record<TextKey, Record<Lang, string>>;

export interface Proposal {
  date: string;
  start?: string | null;
  end?: string | null;
}

export interface PublicInfo {
  locked: boolean;
  siteName: string;
  defaultLang: Lang;
  texts?: Texts;
  features?: { visits: boolean; meals: boolean; wishlist: boolean };
  tz?: string;
  now?: { date: string; time: string };
}

export interface PublicSlot {
  id: number;
  kind: SlotKind;
  date: string;
  start: string;
  end: string;
  note: string;
  capacity: number;
  free: number;
}

export interface PublicVisit {
  kind: SlotKind;
  status: VisitStatus;
  source: VisitSource;
  name: string;
  partySize: number;
  message: string;
  bring: string;
  proposals: Proposal[];
  date: string | null;
  start: string | null;
  end: string | null;
  reply: string;
  createdAt: number;
}

export interface PublicWishItem {
  id: number;
  title: string;
  notes: string;
  url: string;
  price: string;
  quantity: number;
  priority: number;
  tags: string[];
  taken: number;
}

export interface PublicWishlist {
  id: number;
  title: string;
  emoji: string;
  items: PublicWishItem[];
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  color: UserColor;
}

export interface SlotBooking {
  id: number;
  name: string;
  status: VisitStatus;
  partySize: number;
}

export interface Slot {
  id: number;
  kind: SlotKind;
  date: string;
  start: string;
  end: string;
  capacity: number;
  note: string;
  bookings: SlotBooking[];
}

export interface Visit {
  id: number;
  token: string;
  kind: SlotKind;
  source: VisitSource;
  slotId: number | null;
  status: VisitStatus;
  name: string;
  contact: string;
  partySize: number;
  message: string;
  bring: string;
  proposals: Proposal[];
  date: string | null;
  start: string | null;
  end: string | null;
  reply: string;
  lang: Lang;
  createdAt: number;
  updatedAt: number;
}

export interface CalEvent {
  id: number;
  uid: string;
  title: string;
  category: Category;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  location: string;
  notes: string;
  repeat: Repeat;
  repeatUntil: string | null;
  createdBy: number | null;
}

/** One concrete occurrence of a (possibly repeating) event. */
export interface Occurrence extends CalEvent {
  occ: string;
  occEnd: string | null;
}

export interface List {
  id: number;
  title: string;
  kind: ListKind;
  emoji: string;
  isPublic: boolean;
  position: number;
  open: number;
  total: number;
}

export interface Claim {
  id: number;
  itemId: number;
  name: string;
  quantity: number;
  message: string;
  received: boolean;
  thanked: boolean;
  createdAt: number;
}

export interface Item {
  id: number;
  listId: number;
  title: string;
  notes: string;
  url: string;
  price: string;
  quantity: number;
  priority: number;
  tags: string[];
  done: boolean;
  dueDate: string | null;
  assigneeId: number | null;
  phone: string;
  person: string;
  position: number;
  createdAt: number;
  claims?: Claim[];
}

export interface Settings {
  siteName: string;
  defaultLang: Lang;
  timezone: string;
  phoneCc: string;
  showVisits: boolean;
  showMeals: boolean;
  showWishlist: boolean;
  autoConfirm: boolean;
  guestCode: string;
  ntfyUrl: string;
  gcalEmbed: string;
  birthDate: string;
  icsToken: string;
  texts: Texts;
}

export interface HomeData {
  now: { date: string; time: string };
  events: Occurrence[];
  visits: Visit[];
  pending: Visit[];
  todos: (Item & { listTitle: string; listEmoji: string })[];
  openTodos: number;
  thanksOpen: number;
  birthDate: string;
  /** The list the "quick to-do" field on the home screen adds to. */
  todoListId: number | null;
}

export interface ThanksEntry {
  type: "claim" | "gift";
  id: number;
  title: string;
  person: string;
  quantity: number;
  message: string;
  received: boolean;
  thanked: boolean;
  createdAt: number;
}

/** Emoji shown in front of appointment titles (also in the subscribed phone calendars). */
export const CATEGORY_EMOJI: Record<Category, string> = {
  doctor: "🩺",
  kita: "🧸",
  admin: "📄",
  family: "💛",
  other: "📌",
};

// ---------------------------------------------------------------- feeding tracker

export type FeedMethod = "breast" | "shield" | "bottle" | "finger";
export type FeedSide = "left" | "right" | "both";
export const FEED_METHODS: readonly FeedMethod[] = ["breast", "shield", "bottle", "finger"];
export const FEED_SIDES: readonly FeedSide[] = ["left", "right", "both"];
/** Methods where the side (left / right / both) is tracked. */
export const isBreastMethod = (m: FeedMethod) => m === "breast" || m === "shield";
/** Methods where an amount in ml makes sense. */
export const hasAmount = (m: FeedMethod) => m === "bottle" || m === "finger";

export interface Feeding {
  id: number;
  /** UTC timestamps (ms); endedAt is null while the feed is running. */
  startedAt: number;
  endedAt: number | null;
  method: FeedMethod;
  side: FeedSide | null;
  amountMl: number | null;
  notes: string;
  createdBy: number | null;
}

export interface FeedingData {
  serverNow: number;
  feedings: Feeding[];
  running: Feeding | null;
  last: Feeding | null;
}
