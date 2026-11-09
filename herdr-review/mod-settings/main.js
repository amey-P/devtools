// Shows the review settings (mod.open {name: "review-settings"}; bind it in keys.json, or use ⚙ in a review or the inbox).
// The settings screen is the review mod with props {settings: true} (mods/review/settings.js), in one floating
// window. This copy only opens it, then closes itself.
import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay } from "herdr";

export default class ReviewSettings extends View {
  init() {
    openOverlay({ kind: "window", mod: "review", props: { settings: true, float: true }, key: "review-settings", width: 680, height: 0.8 });
    const self = props()?.overlay;
    if (self) closeOverlay(self);
  }

  render() { return div(); }
}
