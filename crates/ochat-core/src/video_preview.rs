//! Limits and container detection for playing an already verified file in chat.
//! The browser only ever receives one of these media types, whatever the file is named.

/// The webview holds the whole video in memory while it plays.
pub const MAX_VIDEO_PREVIEW: u64 = 512 * 1024 * 1024;
pub const VIDEO_CHUNK: usize = 1024 * 1024;
pub const VIDEO_SNIFF_LEN: usize = 12;

pub fn video_mime(prefix: &[u8]) -> Option<&'static str> {
    if prefix.len() >= 8 && &prefix[4..8] == b"ftyp" {
        Some("video/mp4")
    } else if prefix.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        Some("video/webm")
    } else if prefix.starts_with(b"OggS") {
        Some("video/ogg")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_video_containers_are_recognised() {
        assert_eq!(
            video_mime(b"\0\0\0\x18ftypmp42\0\0"),
            Some("video/mp4"),
            "ISO media"
        );
        assert_eq!(
            video_mime(&[0x1a, 0x45, 0xdf, 0xa3, 1, 2]),
            Some("video/webm")
        );
        assert_eq!(video_mime(b"OggS\0\x02"), Some("video/ogg"));
        for other in [
            &b""[..],
            b"ftyp",
            b"<!doctype html>",
            b"<svg xmlns=",
            b"MZ\x90\0\x03\0\0\0",
        ] {
            assert_eq!(video_mime(other), None);
        }
    }
}
