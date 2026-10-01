// Basic building blocks: buttons, form fields, chips, badges, avatars …
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { User, VisitStatus } from "../../shared/types";
import { t } from "../lib/i18n";
import { copyText } from "../lib/links";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { toast } from "./toast";

export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "soft" | "ghost" | "danger";

type ButtonProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, "icon" | "size"> & {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: IconName;
  busy?: boolean;
  block?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
};

export function Button({ variant = "primary", size = "md", icon, busy, block, type = "button", children, class: extra, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      class={cls("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", busy && "is-busy", extra as string)}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <span class="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

type LinkButtonProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "icon" | "size"> & {
  href: string;
  variant?: Variant;
  size?: "sm" | "md";
  icon?: IconName;
  external?: boolean;
};

export function LinkButton({ href, variant = "secondary", size = "md", icon, external, children, class: extra, ...rest }: LinkButtonProps) {
  return (
    <a
      href={href}
      class={cls("btn", `btn-${variant}`, size === "sm" && "btn-sm", extra as string)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children && <span>{children}</span>}
    </a>
  );
}

export function IconButton({ icon, label, class: extra, size = 20, type = "button", ...rest }: Omit<JSX.HTMLAttributes<HTMLButtonElement>, "icon" | "size"> & { icon: IconName; label: string; size?: number; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} class={cls("icon-btn", extra as string)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/**
 * A labelled form field. Use `group` when the content is not a single input
 * (buttons inside a <label> would otherwise be "clicked" by clicking the label).
 */
export function Field({ label, hint, error, children, group, class: extra }: { label?: ComponentChildren; hint?: ComponentChildren; error?: string | null; children: ComponentChildren; group?: boolean; class?: string }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag class={cls("field", error && "has-error", extra)} role={group ? "group" : undefined}>
      {label && <span class="field-label">{label}</span>}
      {children}
      {error ? <span class="field-error">{error}</span> : hint && <span class="field-hint">{hint}</span>}
    </Tag>
  );
}

type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "value" | "onInput"> & {
  value: string;
  onValue: (v: string) => void;
};

export function Input({ value, onValue, class: extra, ...rest }: InputProps) {
  return (
    <input
      class={cls("input", extra as string)}
      value={value}
      onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)}
      {...rest}
    />
  );
}

export function Textarea({ value, onValue, rows = 3, class: extra, ...rest }: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onInput"> & { value: string; onValue: (v: string) => void }) {
  return (
    <textarea
      class={cls("textarea", extra as string)}
      value={value}
      rows={rows}
      onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value)}
      {...rest}
    />
  );
}

export function Select<T extends string>({
  value,
  onValue,
  options,
  label,
  class: extra,
}: {
  value: T;
  onValue: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
  class?: string;
}) {
  return (
    <div class={cls("select-wrap", extra)}>
      <select class="select" value={value} aria-label={label} onChange={(e) => onValue((e.currentTarget as HTMLSelectElement).value as T)}>
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={18} class="select-caret" />
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; hint?: ComponentChildren; disabled?: boolean }) {
  return (
    <label class={cls("switch-row", disabled && "is-disabled")}>
      <span class="switch-text">
        <span>{label}</span>
        {hint && <span class="field-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </label>
  );
}

/** Round, friendly checkbox used in lists. */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      class={cls("check", checked && "is-checked")}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <Icon name="check" size={15} />
    </button>
  );
}

export function Chip({ active, onClick, children, color, class: extra }: { active?: boolean; onClick?: () => void; children: ComponentChildren; color?: string; class?: string }) {
  return (
    <button type="button" class={cls("chip", active && "is-active", color && `c-${color}`, extra)} aria-pressed={!!active} onClick={onClick}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ComponentChildren; badge?: number }[]; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  // When the options don't fit (phones), it scrolls sideways: keep the active one in view and fade
  // the cut-off edge, so it's clear there's more.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
    };
    const reveal = () => {
      const active = el.querySelector<HTMLElement>(".is-active");
      if (!active || el.scrollWidth <= el.clientWidth) return;
      const a = active.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      const b = a + active.offsetWidth;
      if (a < el.scrollLeft) el.scrollLeft = Math.max(0, a - 24);
      else if (b > el.scrollLeft + el.clientWidth) el.scrollLeft = b - el.clientWidth + 24;
    };
    reveal();
    update();
    el.addEventListener("scroll", update, { passive: true });
    // The options get wider once the web font has loaded – check again then.
    const ro = new ResizeObserver(() => {
      reveal();
      update();
    });
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [value, options.length]);
  return (
    <div ref={ref} class={cls("segmented", fade.left && "fade-left", fade.right && "fade-right")} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="tab"
          key={o.value}
          aria-selected={o.value === value}
          class={cls("segment", o.value === value && "is-active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {!!o.badge && <span class="count">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div class="stepper" role="group" aria-label={label}>
      <button type="button" class="icon-btn" aria-label="−" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" class="icon-btn" aria-label="+" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

export function StatusBadge({ status }: { status: VisitStatus }) {
  return <span class={cls("badge", `status-${status}`)}>{t(`status.${status}`)}</span>;
}

export function Avatar({ user, size = 28 }: { user: Pick<User, "displayName" | "color">; size?: number }) {
  return (
    <span class={cls("avatar", `u-${user.color}`)} style={{ width: size, height: size, fontSize: size * 0.45 }} title={user.displayName} aria-hidden="true">
      {user.displayName.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-emoji" aria-hidden="true">
        {emoji}
      </div>
      <p class="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div class="loading" role="status" aria-label={t("common.loading")}>
      <span class="spinner" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div class="error-box" role="alert">
      <span>{error}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/** Read-only text with a copy button (for links). */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="copy-field">
      <input class="input" readOnly value={value} aria-label={label} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
      <Button
        variant="secondary"
        icon={copied ? "check" : "copy"}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            toast(t("common.copied"));
            setTimeout(() => setCopied(false), 1800);
          }
        }}
      >
        {t("common.copy")}
      </Button>
    </div>
  );
}

/** Multi-line text with preserved line breaks. */
export function Lines({ text, class: extra }: { text: string; class?: string }) {
  return (
    <div class={cls("lines", extra)}>
      {text.split("\n").map((line, i) => (
        <p key={i}>{line || " "}</p>
      ))}
    </div>
  );
}
