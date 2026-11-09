// Shows the review inbox (ctrl-shift-i: mod.open {name: "review-inbox"}); Esc or ✕ in the inbox closes it.
// The inbox itself is the review mod with props {inbox: true} (mods/review/inbox.js), in one floating window
// that remembers where it was dropped (pressing the key again brings it back in place). This copy only opens it,
// then closes itself.
import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay } from "herdr";

export default class ReviewInbox extends View {
  init() {
    openOverlay({ kind: "window", mod: "review", props: { inbox: true, float: true }, key: "review-inbox", width: 560, height: 0.7 });
    const self = props()?.overlay;
    if (self) closeOverlay(self);
  }

  render() { return div(); }
}
