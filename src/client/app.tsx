import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { usePath } from "./lib/router";
import { PrefsProvider } from "./prefs";
import { PublicApp } from "./public/PublicApp";
import { Loading } from "./ui/base";
import { ConfirmHost } from "./ui/sheet";
import { ToastHost } from "./ui/toast";

/** The private area is loaded on demand, so guests never download it. */
function LazyFamily({ path }: { path: string }) {
  const [Comp, setComp] = useState<FunctionComponent<{ path: string }> | null>(null);
  useEffect(() => {
    import("./family/FamilyApp").then((m) => setComp(() => m.FamilyApp));
  }, []);
  return Comp ? <Comp path={path} /> : <Loading />;
}

export function App() {
  const path = usePath();
  const family = path === "/family" || path.startsWith("/family/");
  return (
    <PrefsProvider>
      {family ? <LazyFamily path={path} /> : <PublicApp path={path} />}
      <ToastHost />
      <ConfirmHost />
    </PrefsProvider>
  );
}
