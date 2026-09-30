// Public: a guest's personal status page for their request (/r/<token>).
import { useEffect } from "preact/hooks";
import type { Lang, PublicVisit } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { dayLong, timeRange, when } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { getLang, t, tn } from "../lib/i18n";
import { googleCalUrl } from "../lib/links";
import { Link } from "../lib/router";
import { Button, Empty, ErrorBox, LinkButton, Lines, Loading, StatusBadge } from "../ui/base";
import { Icon } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { pickText, saveRequest } from "./PublicApp";

interface StatusData {
  visit: PublicVisit;
  siteName: string;
  tz: string;
  now: { date: string; time: string };
  texts: { visitRules: Record<Lang, string>; mealNotes: Record<Lang, string> };
}

const EMOJI = { pending: "⏳", confirmed: "🎉", declined: "🌧️", cancelled: "🍃" } as const;

export function StatusPage({ token }: { token: string }) {
  const { data, error, setData, reload } = useLoad(() => api<StatusData>(`/public/requests/${token}`), [token]);

  useEffect(() => {
    if (data) saveRequest({ token, kind: data.visit.kind, createdAt: data.visit.createdAt });
  }, [data]);

  if (error) {
    return (
      <div class="status-page">
        <Link href="/" class="back-link">
          <Icon name="chevronLeft" size={18} /> {t("st.backHome")}
        </Link>
        {error instanceof ApiError && error.status === 404 ? (
          <div class="card">
            <Empty emoji="🔍" title={t("err.not_found")} />
          </div>
        ) : (
          <ErrorBox error={errorText(error)} onRetry={reload} />
        )}
      </div>
    );
  }
  if (!data) return <Loading />;

  const v = data.visit;
  const meal = v.kind === "meal";
  const canCancel = (v.status === "pending" || v.status === "confirmed") && (!v.date || v.date >= data.now.date);
  const note = meal ? pickText(data.texts.mealNotes) : pickText(data.texts.visitRules);
  const label = `${meal ? t("st.kindMeal") : t("st.kindVisit")} · ${data.siteName}`;
  const statusText = {
    pending: t("st.pendingText"),
    confirmed: t("st.confirmedText"),
    declined: t("st.declinedText"),
    cancelled: t("st.cancelledText"),
  }[v.status];

  const cancel = async () => {
    if (!(await confirmDialog(t("st.cancelConfirm"), { ok: t("st.cancel"), danger: true }))) return;
    try {
      const r = await api<{ visit: PublicVisit }>(`/public/requests/${token}/cancel`, { body: {} });
      setData({ ...data, visit: r.visit });
      toast(t("st.cancelled"));
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <div class="status-page">
      <Link href="/" class="back-link">
        <Icon name="chevronLeft" size={18} /> {t("st.backHome")}
      </Link>
      <article class={`card status-card st-${v.status}`}>
        <div class="status-emoji" aria-hidden="true">
          {EMOJI[v.status]}
        </div>
        <p class="eyebrow">{meal ? `🍲 ${t("st.kindMeal")}` : `☕ ${t("st.kindVisit")}`}</p>
        <h1 class="status-title">{t("st.hello", { name: v.name })}</h1>
        <StatusBadge status={v.status} />
        <p class="status-text">{statusText}</p>

        <dl class="facts">
          {v.date ? (
            <div>
              <dt>
                <Icon name="calendar" size={18} />
              </dt>
              <dd>{when(v.date, v.start, v.end)}</dd>
            </div>
          ) : (
            <div>
              <dt>
                <Icon name="calendar" size={18} />
              </dt>
              <dd>
                <span class="muted small">{t("st.proposals")}</span>
                <ul class="plain">
                  {v.proposals.map((p, i) => (
                    <li key={i}>
                      {dayLong(p.date)}
                      {p.start ? `, ${timeRange(p.start, p.end)}` : ` · ${t("st.flexible")}`}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {!meal && (
            <div>
              <dt>
                <Icon name="visits" size={18} />
              </dt>
              <dd>{tn("common.persons", v.partySize)}</dd>
            </div>
          )}
          {v.bring && (
            <div>
              <dt aria-label={t("st.bring")}>🍲</dt>
              <dd>{v.bring}</dd>
            </div>
          )}
          {v.message && (
            <div>
              <dt>
                <Icon name="chat" size={18} />
              </dt>
              <dd class="quote">{v.message}</dd>
            </div>
          )}
        </dl>

        {v.reply && (
          <div class="reply">
            <p class="reply-label">💬 {t("st.reply")}</p>
            <Lines text={v.reply} />
          </div>
        )}

        {v.status === "confirmed" && v.date && (
          <div class="cal-links">
            <p class="muted small">{t("st.inCalendar")}</p>
            <div class="row wrap">
              <LinkButton
                href={googleCalUrl(
                  { title: label, date: v.date, start: v.start, end: v.end, details: location.href },
                  data.tz,
                )}
                external
                icon="calendar"
                size="sm"
              >
                {t("st.addGoogle")}
              </LinkButton>
              <LinkButton href={`/api/public/requests/${token}/ics?lang=${getLang()}`} icon="download" size="sm">
                {t("st.addIcs")}
              </LinkButton>
            </div>
          </div>
        )}

        {v.status === "confirmed" && note && (
          <details class="note">
            <summary>{meal ? `🍲 ${t("pub.mealNotes.title")}` : `🙏 ${t("pub.rules.title")}`}</summary>
            <Lines text={note} />
          </details>
        )}

        {canCancel && (
          <div class="status-actions">
            <Button variant="ghost" icon="x" onClick={cancel}>
              {t("st.cancel")}
            </Button>
          </div>
        )}
      </article>
    </div>
  );
}
