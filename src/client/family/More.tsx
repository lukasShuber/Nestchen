// Mobile "More" tab: the pages that don't fit in the bottom bar.
import { t } from "../lib/i18n";
import { Link } from "../lib/router";
import { LangSwitch, ThemeSelect } from "../prefs";
import { Avatar, Button } from "../ui/base";
import { Icon } from "../ui/icons";
import { Page } from "./common";
import { useFamily } from "./context";

export function MorePage() {
  const { me, logout, badges } = useFamily();
  return (
    <Page title={t("more.title")}>
      <div class="card menu">
        <Link href="/family/thanks" class="menu-item">
          <Icon name="gift" />
          <span>{t("nav.thanks")}</span>
          {!!badges.thanks && <span class="count">{badges.thanks}</span>}
          <Icon name="chevronRight" size={18} class="muted" />
        </Link>
        <Link href="/family/settings" class="menu-item">
          <Icon name="settings" />
          <span>{t("nav.settings")}</span>
          <Icon name="chevronRight" size={18} class="muted" />
        </Link>
        <a href="/?view=public" target="_blank" rel="noopener" class="menu-item">
          <Icon name="globe" />
          <span>{t("nav.publicPage")}</span>
          <Icon name="external" size={18} class="muted" />
        </a>
      </div>
      <div class="card stack">
        <div class="row between">
          <span>{t("common.language")}</span>
          <LangSwitch />
        </div>
        <div class="row between wrap">
          <span>{t("common.theme")}</span>
          <ThemeSelect />
        </div>
      </div>
      <div class="card">
        <div class="me-row">
          <Avatar user={me} size={36} />
          <span class="me-name">{me.displayName}</span>
          <Button variant="secondary" icon="logout" onClick={logout}>
            {t("nav.logout")}
          </Button>
        </div>
      </div>
    </Page>
  );
}
