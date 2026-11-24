// The generic mod runtime: a View that runs any core speaking the shell protocol (shell/gleam.ts).
// - init: the core's init effects, then a `cx.timer.every` that sends the core's tick event.
//   While `herdr-app check` runs (`checking()`), no effect runs and no timer starts (spec G6).
// - dispatch: update, run the effects, and `cx.notify()` only when the state changed.
// - render: view + interpret, nothing else (no notify, no spawn).
// No `cx` is kept: each callback gets its own and passes it on.
import { View } from "gpui-kit";
import type { AsyncContext, Context } from "gpui-kit";
import { appHome, checking } from "herdr";
import type { App } from "./gleam.ts";
import { interpret } from "./interpret.ts";
import { runEffects } from "./effects.ts";
import { snapshot } from "./snapshot.ts";

export function mount<S, Ev>(app: App<S, Ev>, modName: string, tickMs = 150) {
  return class extends View {
    state: S;

    init(_props: unknown, cx: AsyncContext) {
      const step = app.init(modName, appHome());
      this.state = step.state;
      if (checking()) return;
      runEffects(step.effects, cx, this.dispatch);
      cx.timer.every(tickMs, (cx) => this.dispatch(app.tick(this.state, snapshot()), cx));
    }

    dispatch = (event: Ev, cx: Context) => {
      const before = this.state;
      const step = app.update(before, event);
      this.state = step.state;
      runEffects(step.effects, cx, this.dispatch);
      if (app.changed(before, step.state)) cx.notify();
    };

    render() {
      return interpret(app.view(this.state, snapshot()), this.dispatch);
    }
  };
}
