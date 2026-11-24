//// The shell's only entry point. It speaks a small protocol that knows nothing about space icons,
//// so `shell/` stays generic (spec G5):
////
//// - `init(mod_name, app_home) -> Step`, `update(state, event) -> Step`
//// - `tick(state, raw_snapshot) -> Event`: the timer's event (spec §6.1, "Tick source")
//// - `view(state, raw_snapshot) -> Rendered`: the tree as JSON text in the recorder's format
////   `{kind, args, attrs: [{m, a}], children}`, one attr per builder call. An argument that is
////   not plain JSON is a marker: `{"$": "event", "i": n}` (the n-th entry of `events`),
////   `{"$": "stop"}` (a `cx.stop_propagation()` handler) or `{"$": "undefined"}`.
//// - `changed(a, b)`: whether to notify.
////
//// An effect is `Out(op, args, reply)`: `args` is JSON text, and `reply` builds the answering
//// event from what the op returned (`ok`) or the error text (`err`). Raw snapshots are decoded
//// here, so the shell only hands over `{spaces: spaces(), theme: theme(), window: window()}`.

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json.{type Json}
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import space_icons/model.{
  type Effect, type Event, type Snapshot, type State, Flags, GeoDirListed, Log,
  MkdirAndList, OpenOverlay, OverridesRead, ReadText, RunCommand, Snapshot,
  Space, Tick, Window, WriteFile, Written,
}
import space_icons/update
import space_icons/view.{type Attr, type Node}

pub type Step {
  Step(state: State, effects: List(Out))
}

pub type Out {
  Out(op: String, args: String, reply: Reply)
}

pub type Reply {
  NoReply
  Reply(ok: fn(Dynamic) -> Event, err: fn(String) -> Event)
}

pub type Rendered {
  Rendered(tree: String, events: List(Event))
}

pub fn init(mod_name: String, app_home: String) -> Step {
  let #(state, effects) =
    update.init(Flags(mod_name: mod_name, app_home: app_home))
  Step(state, list.map(effects, out))
}

pub fn update(state: State, event: Event) -> Step {
  let #(state, effects) = update.update(state, event)
  Step(state, list.map(effects, out))
}

pub fn tick(state: State, raw: Dynamic) -> Event {
  Tick(update.needed_files(state, decode_snapshot(raw)))
}

pub fn view(state: State, raw: Dynamic) -> Rendered {
  let #(tree, events) = encode_node(view.view(state, decode_snapshot(raw)), [])
  Rendered(json.to_string(tree), list.reverse(events))
}

pub fn changed(a: State, b: State) -> Bool {
  a != b
}

// --- effects ------------------------------------------------------------------

fn out(effect: Effect) -> Out {
  case effect {
    ReadText(path) ->
      Out(
        "read_text",
        args([#("path", json.string(path))]),
        Reply(
          fn(v) {
            OverridesRead(
              decode.run(v, decode.optional(decode.string))
              |> result.replace_error("readTextFile: not a string"),
            )
          },
          fn(e) { OverridesRead(Error(e)) },
        ),
      )
    MkdirAndList(dir) ->
      Out(
        "mkdir_list",
        args([#("dir", json.string(dir))]),
        Reply(
          fn(v) {
            GeoDirListed(
              decode.run(v, decode.list(decode.string))
              |> result.replace_error("readdir: not a list of names"),
            )
          },
          fn(e) { GeoDirListed(Error(e)) },
        ),
      )
    WriteFile(path, file, content) ->
      Out(
        "write_file",
        args([#("path", json.string(path)), #("content", json.string(content))]),
        Reply(fn(_) { Written(file, Ok(Nil)) }, fn(e) {
          Written(file, Error(e))
        }),
      )
    RunCommand(name, cmd_args) ->
      Out(
        "run",
        args([
          #("name", json.string(name)),
          #("args", option.unwrap(cmd_args, json.null())),
        ]),
        NoReply,
      )
    OpenOverlay(spec) -> Out("open_overlay", args([#("spec", spec)]), NoReply)
    Log(message) ->
      Out("log", args([#("message", json.string(message))]), NoReply)
  }
}

fn args(fields: List(#(String, Json))) -> String {
  json.to_string(json.object(fields))
}

// --- snapshot -----------------------------------------------------------------

/// Each part falls back on its own, so a theme the decoder cannot read still shows the spaces.
pub fn decode_snapshot(raw: Dynamic) -> Snapshot {
  let space = {
    use id <- decode.field("id", decode.string)
    use name <- decode.field("name", decode.string)
    use status <- decode.optional_field(
      "status",
      None,
      decode.optional(decode.string),
    )
    use active <- decode.field("active", decode.bool)
    use machine <- decode.optional_field(
      "machine",
      None,
      decode.optional(decode.string),
    )
    decode.success(Space(id, name, status, active, machine))
  }
  let window = {
    use platform <- decode.field("platform", decode.string)
    use fullscreen <- decode.optional_field("fullscreen", False, decode.bool)
    decode.success(Window(platform, fullscreen))
  }
  Snapshot(
    spaces: part(raw, "spaces", decode.list(space), []),
    theme: part(
      raw,
      "theme",
      decode.dict(decode.string, decode.string),
      dict.new(),
    ),
    window: part(raw, "window", decode.optional(window), None),
  )
}

fn part(
  raw: Dynamic,
  name: String,
  decoder: decode.Decoder(a),
  default: a,
) -> a {
  decode.run(raw, decode.at([name], decoder)) |> result.unwrap(default)
}

// --- tree -----------------------------------------------------------------------

/// `events` is built in reverse: an event's marker index is its position from the front.
fn encode_node(node: Node, events: List(Event)) -> #(Json, List(Event)) {
  let #(kind, kind_args) = case node.kind {
    view.HFlex -> #("h_flex", [])
    view.VFlex -> #("v_flex", [])
    view.Div -> #("div", [])
    view.Svg(path) -> #("svg", [json.string(path)])
  }
  let #(attrs, events) = encode_attrs(node.attrs, events)
  let #(children, events) =
    list.fold(node.children, #([], events), fn(acc, child) {
      let #(done, events) = acc
      let #(c, events) = encode_node(child, events)
      #([c, ..done], events)
    })
  #(
    json.object([
      #("kind", json.string(kind)),
      #("args", json.preprocessed_array(kind_args)),
      #("attrs", json.preprocessed_array(attrs)),
      #("children", json.preprocessed_array(list.reverse(children))),
    ]),
    events,
  )
}

fn encode_attrs(
  attrs: List(Attr),
  events: List(Event),
) -> #(List(Json), List(Event)) {
  let #(done, events) =
    list.fold(attrs, #([], events), fn(acc, attr) {
      let #(done, events) = acc
      let #(a, events) = encode_attr(attr, events)
      #([a, ..done], events)
    })
  #(list.reverse(done), events)
}

fn encode_attr(attr: Attr, events: List(Event)) -> #(Json, List(Event)) {
  let call = fn(m, a) { #(call_json(m, a), events) }
  let int = json.int
  let color = fn(c) {
    case c {
      Some(s) -> json.string(s)
      None -> marker("undefined", [])
    }
  }
  case attr {
    view.Id(s) -> call("id", [json.string(s)])
    view.Relative -> call("relative", [])
    view.Absolute -> call("absolute", [])
    view.WFull -> call("w_full", [])
    view.SizeFull -> call("size_full", [])
    view.MinH(n) -> call("min_h", [int(n)])
    view.H(n) -> call("h", [int(n)])
    view.Size(n) -> call("size", [int(n)])
    view.FlexNone -> call("flex_none", [])
    view.Flex1 -> call("flex_1", [])
    view.Top(n) -> call("top", [int(n)])
    view.Bottom(n) -> call("bottom", [int(n)])
    view.Left(n) -> call("left", [int(n)])
    view.Right(n) -> call("right", [int(n)])
    view.W(n) -> call("w", [int(n)])
    view.Pt(n) -> call("pt", [int(n)])
    view.Pb(n) -> call("pb", [int(n)])
    view.Gap(n) -> call("gap", [int(n)])
    view.Rounded(n) -> call("rounded", [int(n)])
    view.Bg(c) -> call("bg", [color(c)])
    view.Border1 -> call("border_1", [])
    view.Border2 -> call("border_2", [])
    view.BorderColor(c) -> call("border_color", [color(c)])
    view.TextColor(c) -> call("text_color", [color(c)])
    view.JustifyCenter -> call("justify_center", [])
    view.ItemsCenter -> call("items_center", [])
    view.CursorPointer -> call("cursor_pointer", [])
    view.OverflowYScrollbar -> call("overflow_y_scrollbar", [])
    view.Tooltip(s) -> call("tooltip", [json.string(s)])
    view.Hover(style) -> {
      let #(style, events) = encode_attrs(style, events)
      #(call_json("hover", [json.preprocessed_array(style)]), events)
    }
    view.LoopOpacity(from, to, period) ->
      call("loop", [
        json.string("opacity"),
        json.object([
          #("from", json.float(from)),
          #("to", json.float(to)),
          #("period", int(period)),
        ]),
      ])
    view.OnClick(event) -> #(call_json("on_click", [event_marker(events)]), [
      event,
      ..events
    ])
    view.OnRightDown(event) -> #(
      call_json("on_mouse_down", [json.string("right"), event_marker(events)]),
      [event, ..events],
    )
    view.StopLeftDown ->
      call("on_mouse_down", [json.string("left"), marker("stop", [])])
  }
}

fn call_json(m: String, a: List(Json)) -> Json {
  json.object([#("m", json.string(m)), #("a", json.preprocessed_array(a))])
}

fn marker(kind: String, fields: List(#(String, Json))) -> Json {
  json.object([#("$", json.string(kind)), ..fields])
}

fn event_marker(events: List(Event)) -> Json {
  marker("event", [#("i", json.int(list.length(events)))])
}
