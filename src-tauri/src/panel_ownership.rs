//! Window relationships, independent of native APIs (issue #281, Part 2).
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct Panel {
    pub owner: String,
    pub session: String,
}

#[derive(Default)]
pub struct Panels(pub HashMap<String, Panel>);

pub fn editor_label(label: &str) -> bool {
    label == "main"
        || label
            .strip_prefix("main-")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
}

pub fn navigator_label(owner: &str) -> Option<String> {
    editor_label(owner).then(|| format!("panel-{owner}-navigator"))
}

impl Panels {
    pub fn owned(&self, owner: &str) -> Vec<String> {
        self.0
            .iter()
            .filter(|(_, p)| p.owner == owner)
            .map(|(label, _)| label.clone())
            .collect()
    }

    pub fn take_owned(&mut self, owner: &str, session: Option<&str>) -> Vec<(String, Panel)> {
        let labels: Vec<_> = self
            .0
            .iter()
            .filter(|(_, p)| p.owner == owner && session.is_none_or(|session| p.session == session))
            .map(|(label, _)| label.clone())
            .collect();
        labels
            .into_iter()
            .filter_map(|label| self.0.remove(&label).map(|panel| (label, panel)))
            .collect()
    }

    pub fn targets(&self, owner: &str, session: &str) -> Vec<String> {
        self.0
            .iter()
            .filter(|(_, p)| p.owner == owner && p.session == session)
            .map(|(label, _)| label.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_editor_windows_can_own_panels() {
        for label in ["panel-main-navigator", "splashscreen", "main-", "foreign"] {
            assert!(navigator_label(label).is_none());
        }
        assert_eq!(
            navigator_label("main-2").as_deref(),
            Some("panel-main-2-navigator")
        );
    }

    #[test]
    fn revoking_an_inflight_open_or_old_session_cannot_affect_its_replacement() {
        let mut panels = Panels::default();
        panels.0.insert(
            "panel-main-navigator-1".into(),
            Panel {
                owner: "main".into(),
                session: "old".into(),
            },
        );
        let closed = panels.take_owned("main", None);
        assert_eq!(closed.len(), 1);
        assert!(panels.targets("main", "old").is_empty());
        panels.0.insert(
            "panel-main-navigator-2".into(),
            Panel {
                owner: "main".into(),
                session: "new".into(),
            },
        );
        assert!(panels.take_owned("main", Some("old")).is_empty());
        // An old native Destroyed event only removes its unique old label.
        assert!(panels.0.remove("panel-main-navigator-1").is_none());
        assert_eq!(
            panels.targets("main", "new"),
            vec!["panel-main-navigator-2"]
        );
    }

    #[test]
    fn document_switches_and_other_owners_cannot_receive_old_snapshots() {
        let mut panels = Panels::default();
        panels.0.insert(
            "panel-main-navigator".into(),
            Panel {
                owner: "main".into(),
                session: "new".into(),
            },
        );
        panels.0.insert(
            "panel-main-2-navigator".into(),
            Panel {
                owner: "main-2".into(),
                session: "old".into(),
            },
        );
        assert!(panels.targets("main", "old").is_empty());
        assert_eq!(panels.targets("main", "new"), vec!["panel-main-navigator"]);
        let owned = panels.owned("main");
        for label in owned {
            panels.0.remove(&label);
        }
        assert_eq!(panels.owned("main-2"), vec!["panel-main-2-navigator"]);
    }
}
