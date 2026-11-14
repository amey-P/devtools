//! Where a new subagent pane goes: master + stack.
//!
//! The parent keeps the left half of its tab. The first child splits the parent
//! right; every later child halves the largest child pane along its long side.
//! Herdr splits are always 50/50, so halving the largest pane keeps every pane
//! within 2x of the others. When no pane can be halved without getting too
//! small, the child gets its own tab.

/// Smallest pane worth splitting into (terminal cells).
pub const MIN_COLS: u32 = 60;
pub const MIN_ROWS: u32 = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneInfo {
    pub terminal: String,
    pub pane: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    Right,
    Down,
}

impl Dir {
    pub fn as_str(self) -> &'static str {
        match self {
            Dir::Right => "right",
            Dir::Down => "down",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placement {
    Split { pane: String, dir: Dir },
    Tab,
}

fn fits(p: &PaneInfo, dir: Dir) -> bool {
    match dir {
        Dir::Right => p.cols / 2 >= MIN_COLS,
        Dir::Down => p.rows / 2 >= MIN_ROWS,
    }
}

/// Split `p` along its long side (cells are about twice as tall as wide),
/// or the other way if that half would be too small.
fn split(p: &PaneInfo, preferred: Dir) -> Option<Placement> {
    let other = if preferred == Dir::Right { Dir::Down } else { Dir::Right };
    [preferred, other].into_iter().find(|d| fits(p, *d)).map(|dir| Placement::Split { pane: p.pane.clone(), dir })
}

/// `children` are the parent's child panes in its tab, in `herdr-app ls` order.
pub fn choose(parent: &PaneInfo, children: &[PaneInfo]) -> Placement {
    // First child: the parent keeps the left half.
    let Some(first) = children.first() else {
        return split(parent, Dir::Right).unwrap_or(Placement::Tab);
    };
    // Largest child; the earliest wins a tie.
    let target = children.iter().fold(first, |best, c| if c.cols * c.rows > best.cols * best.rows { c } else { best });
    let long = if target.cols > 2 * target.rows { Dir::Right } else { Dir::Down };
    split(target, long).unwrap_or(Placement::Tab)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(t: &str, cols: u32, rows: u32) -> PaneInfo {
        PaneInfo { terminal: t.into(), pane: format!("p-{t}"), cols, rows }
    }
    fn at(t: &str, dir: Dir) -> Placement {
        Placement::Split { pane: format!("p-{t}"), dir }
    }

    #[test]
    fn first_child_splits_parent_right() {
        assert_eq!(choose(&p("me", 160, 80), &[]), at("me", Dir::Right));
        // even when the parent is tall
        assert_eq!(choose(&p("me", 130, 120), &[]), at("me", Dir::Right));
    }

    #[test]
    fn first_child_falls_back_when_parent_is_narrow() {
        assert_eq!(choose(&p("me", 100, 80), &[]), at("me", Dir::Down));
        assert_eq!(choose(&p("me", 100, 15), &[]), Placement::Tab);
    }

    #[test]
    fn largest_child_wins_and_ties_go_to_the_earliest() {
        let me = p("me", 80, 80);
        assert_eq!(choose(&me, &[p("a", 80, 40), p("b", 160, 40)]), at("b", Dir::Right));
        assert_eq!(choose(&me, &[p("a", 80, 40), p("b", 80, 40)]), at("a", Dir::Down));
    }

    #[test]
    fn splits_along_the_long_side() {
        let me = p("me", 80, 80);
        assert_eq!(choose(&me, &[p("a", 200, 40)]), at("a", Dir::Right));
        assert_eq!(choose(&me, &[p("a", 150, 80)]), at("a", Dir::Down));
    }

    #[test]
    fn too_small_tries_the_other_way_then_a_tab() {
        let me = p("me", 80, 80);
        // wide but narrow: halving right leaves 55 cols, so split down
        assert_eq!(choose(&me, &[p("a", 110, 40)]), at("a", Dir::Down));
        assert_eq!(choose(&me, &[p("a", 100, 15)]), Placement::Tab);
    }
}
