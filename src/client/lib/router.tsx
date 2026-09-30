// Minimal client-side router based on the History API.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search + location.hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  listeners.forEach((fn) => fn());
  if (!to.includes("#")) window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

type AnchorProps = JSX.HTMLAttributes<HTMLAnchorElement> & { href: string };

/** An <a> that navigates without a page reload (and still works with cmd/ctrl-click). */
export function Link({ href, onClick, ...props }: AnchorProps) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
}
