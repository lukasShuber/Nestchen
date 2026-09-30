import "@fontsource-variable/nunito";
import "./styles.css";
import { render } from "preact";
import { App } from "./app";

render(<App />, document.getElementById("app")!);
