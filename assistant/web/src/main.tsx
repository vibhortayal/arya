import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/* The current app's stylesheets, unchanged: both apps draw from one
 * set of classes until the switch-over (PORTING.md). */
import "../../pwa/styles.css";
import "../../pwa/hunt.css";
import "../../pwa/pack.css";
import "../../pwa/album.css";
import "../../pwa/haul.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
