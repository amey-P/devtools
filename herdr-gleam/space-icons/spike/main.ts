// Phase 1 spike shell: renders one line that comes from Gleam. Deleted after the gate.
import { View, div } from "gpui-kit";
import { theme } from "herdr";
import { line } from "../build/dev/javascript/space_icons/spike.mjs";

export default class Spike extends View {
  render() {
    const t = theme();
    return div().size_full().p(16).bg(t.chrome).text_color(t.foreground).child(line());
  }
}
