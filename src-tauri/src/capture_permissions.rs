//! Short-lived grants for capture initiated from the trusted main webview.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Default)]
pub struct CapturePermissions(Mutex<HashMap<String, (Uuid, Uuid, Uuid, Instant)>>);

impl CapturePermissions {
    pub fn prepare(&self, kind: &str, room: Uuid, media: Uuid, lease: Uuid) -> Result<(), String> {
        if !matches!(kind, "camera" | "screen") {
            return Err("Invalid capture source".into());
        }
        self.0
            .lock()
            .unwrap()
            .insert(kind.into(), (room, media, lease, Instant::now()));
        Ok(())
    }

    pub fn consume(&self, kind: &str, active: impl FnOnce(Uuid, Uuid, Uuid) -> bool) -> bool {
        self.0
            .lock()
            .unwrap()
            .remove(kind)
            .is_some_and(|(room, media, lease, at)| {
                at.elapsed() < Duration::from_secs(300) && active(room, media, lease)
            })
    }

    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }
}

static DEV_ORIGIN: OnceLock<tauri::Url> = OnceLock::new();

pub fn configure_dev_origin(url: Option<&tauri::Url>) {
    // The CLI serves frontendDist over HTTP in development. Packaged builds
    // must continue to accept only the application protocol.
    if tauri::is_dev() {
        if let Some(url) = url {
            let _ = DEV_ORIGIN.set(url.clone());
        }
    }
}

fn trusted_dev_url(url: &tauri::Url, configured: &tauri::Url) -> bool {
    url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin() == configured.origin()
}

pub fn trusted_url(url: &tauri::Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    ) || (tauri::is_dev()
        && DEV_ORIGIN
            .get()
            .is_some_and(|configured| trusted_dev_url(url, configured)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn development_origin_is_exact_and_loopback_only() {
        let configured = "http://localhost:1430/".parse().unwrap();
        assert!(trusted_dev_url(
            &"http://localhost:1430/viewer.html".parse().unwrap(),
            &configured
        ));
        for untrusted in [
            "http://localhost:1431/",
            "http://127.0.0.1:1430/",
            "https://localhost:1430/",
            "http://localhost.evil:1430/",
            "http://user@localhost:1430/",
        ] {
            assert!(!trusted_dev_url(&untrusted.parse().unwrap(), &configured));
        }
        let remote = "http://example.com:1430/".parse().unwrap();
        assert!(!trusted_dev_url(&remote, &remote));
        let custom_port = "http://127.0.0.1:1450/".parse().unwrap();
        assert!(trusted_dev_url(&custom_port, &custom_port));
    }
    #[test]
    fn grants_are_single_use_source_specific_and_bound_to_active_session() {
        let grants = CapturePermissions::default();
        let room = Uuid::new_v4();
        let media = Uuid::new_v4();
        let lease = Uuid::new_v4();
        grants.prepare("camera", room, media, lease).unwrap();
        assert!(!grants.consume("screen", |_, _, _| true));
        assert!(grants.consume("camera", |r, m, l| r == room && m == media && l == lease));
        assert!(!grants.consume("camera", |_, _, _| true));
        grants.prepare("screen", room, media, lease).unwrap();
        assert!(!grants.consume("screen", |_, _, _| false));
        grants.prepare("screen", room, media, lease).unwrap();
        grants.clear();
        assert!(!grants.consume("screen", |_, _, _| true));
        assert!(grants.prepare("microphone", room, media, lease).is_err());
    }
    #[test]
    fn remote_and_lookalike_origins_are_rejected() {
        for url in [
            "https://example.com",
            "http://tauri.localhost.evil",
            "file:///tmp/index.html",
        ] {
            assert!(!trusted_url(&url.parse().unwrap()));
        }
        assert!(trusted_url(&"http://tauri.localhost/".parse().unwrap()));
        assert!(trusted_url(&"tauri://localhost/".parse().unwrap()));
    }
}
