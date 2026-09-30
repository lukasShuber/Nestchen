import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Settings, User } from "../../shared/types";

export interface FamilyCtx {
  me: User;
  users: User[];
  settings: Settings;
  setSettings: (s: Settings) => void;
  reloadAccounts: () => Promise<void>;
  badges: { pending: number; thanks: number };
  refreshBadges: () => void;
  logout: () => Promise<void>;
}

export const FamilyContext = createContext<FamilyCtx>(null as unknown as FamilyCtx);
export const useFamily = () => useContext(FamilyContext);
