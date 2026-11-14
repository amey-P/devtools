// The old name of the peruse mod (herdr-review installed itself as mods/review). Some callers outside this repo still
// open "review", Herdr's markdown viewer above all (its Review button: pane.split {mod: "review", props: {kind: "file",
// file}}), and so do key bindings from before the rename. This copy hands its props to "peruse" and closes itself:
//   as an overlay (mod.open {name: "review"})   opens the peruse launcher instead
//   as a pane (pane.split {mod: "review", …})   splits a peruse pane off this one with the same props, then closes this one
import { View, div } from "gpui-kit";
import { props, panes, run, closeOverlay } from "herdr";

export default class ReviewCompat extends View {
  init() {
    const p = props() ?? {};
    if (p.overlay) {
      run("mod.open", { name: "peruse" });
      closeOverlay(p.overlay);
      return;
    }
    const mine = panes().filter((x) => x.mod === "review");
    const own = (mine.find((x) => x.focused) ?? mine[mine.length - 1])?.pane ?? null;
    run("pane.split", { ...(own ? { pane: own } : {}), direction: "right", mod: "peruse", props: p });
    if (own) run("pane.close", { pane: own });
  }

  render() { return div(); }
}
