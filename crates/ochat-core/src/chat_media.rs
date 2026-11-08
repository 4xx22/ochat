//! Limits and container detection for playing an already verified file in chat.
//! The browser only ever receives one of these media types, whatever the file is named.
//! MP4, WebM and Ogg hold audio or video: the chat player picks by file name.

/// The webview holds the whole file in memory while it plays.
pub const MAX_MEDIA_PREVIEW: u64 = 512 * 1024 * 1024;
pub const MEDIA_CHUNK: usize = 1024 * 1024;
pub const MEDIA_SNIFF_LEN: usize = 12;
pub const MEDIA_NOT_PLAYABLE: &str = "This file cannot be played in chat";

pub fn media_mime(prefix: &[u8]) -> Option<&'static str> {
    if prefix.len() >= 8 && &prefix[4..8] == b"ftyp" {
        Some("video/mp4")
    } else if prefix.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        Some("video/webm")
    } else if prefix.starts_with(b"OggS") {
        Some("video/ogg")
    } else if prefix.starts_with(b"fLaC") {
        Some("audio/flac")
    } else if prefix.len() >= 12 && prefix.starts_with(b"RIFF") && &prefix[8..12] == b"WAVE" {
        Some("audio/wav")
    } else if prefix.starts_with(b"ID3") {
        Some("audio/mpeg")
    } else if let [0xff, second, ..] = prefix {
        // Both frame formats open with a sync run; the layer bits tell them apart.
        match (second & 0xf0 == 0xf0, second & 0xe0 == 0xe0, second & 0x06) {
            (true, _, 0) => Some("audio/aac"),
            (_, true, 2..) => Some("audio/mpeg"),
            _ => None,
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_media_containers_are_recognised() {
        assert_eq!(
            media_mime(b"\0\0\0\x18ftypmp42\0\0"),
            Some("video/mp4"),
            "ISO media"
        );
        assert_eq!(
            media_mime(&[0x1a, 0x45, 0xdf, 0xa3, 1, 2]),
            Some("video/webm")
        );
        assert_eq!(media_mime(b"OggS\0\x02"), Some("video/ogg"));
        assert_eq!(media_mime(b"fLaC\0\0\0\x22"), Some("audio/flac"));
        assert_eq!(media_mime(b"RIFF\x24\0\0\0WAVEfmt "), Some("audio/wav"));
        assert_eq!(media_mime(b"ID3\x04\0\0"), Some("audio/mpeg"));
        assert_eq!(media_mime(&[0xff, 0xfb, 0x90, 0x64]), Some("audio/mpeg"));
        assert_eq!(media_mime(&[0xff, 0xf3, 0x40, 0xc0]), Some("audio/mpeg"));
        assert_eq!(media_mime(&[0xff, 0xf1, 0x50, 0x80]), Some("audio/aac"));
        assert_eq!(media_mime(&[0xff, 0xf9, 0x50, 0x80]), Some("audio/aac"));
        for other in [
            &b""[..],
            b"ftyp",
            b"<!doctype html>",
            b"<svg xmlns=",
            b"MZ\x90\0\x03\0\0\0",
            b"RIFF\x24\0\0\0AVI LIST",
            &[0xff, 0xd8, 0xff, 0xe0],
            &[0xff],
        ] {
            assert_eq!(media_mime(other), None);
        }
    }
}
