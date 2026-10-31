import { StrictMode } from "react";
/* Strings first: every screen reads them on its first render. */
import "./i18n";
import { createRoot } from "react-dom/client";
/* The plain-JS app's stylesheets, moved here unchanged at the
 * switch-over: the screens keep its class names and ids. */
import "./styles/styles.css";
import "./styles/hunt.css";
import "./styles/pack.css";
import "./styles/album.css";
import "./styles/haul.css";
import { App } from "./App";
import { registerWorker } from "./app/sw-register";

/* A phone with 4 cores or fewer drops the costly blur (styles.css). */
if ((navigator.hardwareConcurrency || 8) <= 4) document.documentElement.classList.add("lowend");

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
registerWorker();
