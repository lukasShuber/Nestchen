import type { User } from "../shared/types";
import type { SettingsMap } from "./db";

export interface Bindings {
  DB: D1Database;
  /** Secret passphrase needed to create the parents' accounts (set in the Cloudflare dashboard). */
  SETUP_CODE?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    settings: SettingsMap;
    user: User;
    sessionId: string;
    unlocked: boolean;
  };
};
