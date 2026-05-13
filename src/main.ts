/**
 * App entry. Imports global styles, registers the <app-root> custom
 * element. Component-level Web Components self-register on import.
 *
 * Phase 1 deliberately keeps this thin — every region the shell
 * renders is mounted inside <app-root>. State wiring (store, deck,
 * URL hash) plugs in via the next commit without changing this file.
 */

import "./ui/reset.css";
import "./ui/theme.css";
import "./ui/components.css";

import "./components/app-root";
