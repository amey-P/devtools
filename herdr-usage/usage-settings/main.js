// Shows the usage settings (ctrl-shift-u: mod.open {name: "usage-settings"}); Esc or ✕ closes it.
// The settings screen is the agent-usage mod with props {settings: true} (mods/agent-usage/settings.js),
// in one floating window. This copy only opens it, then closes itself.
import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay } from "herdr";

export default class UsageSettings extends View {
  init() {
    openOverlay({ kind: "window", mod: "agent-usage", props: { settings: true, float: true }, key: "usage-settings", width: 640, height: 0.75 });
    const self = props()?.overlay;
    if (self) closeOverlay(self);
  }

  render() { return div(); }
}
