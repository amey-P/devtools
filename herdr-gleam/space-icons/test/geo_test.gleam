//// A few corpus (b) rows pinned in Gleam (name "" = row 0); parity/geo.test.js checks all of them.

import gleam/option.{None, Some}
import space_icons/geo

pub fn geo_file_pins_test() {
  assert geo.geo_file("", Some("tiles")) == "4mejsq.svg"
  assert geo.geo_file("", Some("overlap")) == "1pz3hp4.svg"
  assert geo.geo_file("", None) == "u2rzxu.svg"
}

pub fn family_pick_test() {
  // An unknown family falls back to the seed's pick, exactly like no family.
  assert geo.geo_icon("", None).family == "stripes"
  assert geo.geo_icon("", Some("Tiles")) == geo.geo_icon("", None)
  assert geo.geo_icon("  ", Some("radial")).family == "radial"
}
