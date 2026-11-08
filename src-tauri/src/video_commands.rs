//! Serves verified local files to the chat player. Nothing is fetched from the peer here.
use super::*;
use desktop::TransferRecord;
use ochat_core::video_preview::{MAX_VIDEO_PREVIEW, VIDEO_CHUNK, VIDEO_SNIFF_LEN, video_mime};
use std::io::{Read, Seek, SeekFrom};

#[derive(Serialize)]
pub struct ChatVideoInfo {
    size: u64,
    mime: &'static str,
    too_large: bool,
}

enum VideoSource {
    Offered(Arc<ochat_core::ChatNode>),
    Download { path: PathBuf, size: u64 },
}

impl VideoSource {
    /// Returns the total size and the bytes at `position`, up to `max`.
    fn read(self, id: Uuid, position: u64, max: usize) -> Result<Option<(u64, Vec<u8>)>, String> {
        match self {
            Self::Offered(client) => client.read_offered_file(id, position, max).map_err(error),
            Self::Download { path, size } => {
                let mut file = std::fs::File::open(path)
                    .map_err(|_| "This video was moved or deleted from its saved location")?;
                if !file.metadata().map_err(error)?.is_file()
                    || file.metadata().map_err(error)?.len() != size
                {
                    return Err("This video changed after it was received".into());
                }
                file.seek(SeekFrom::Start(position)).map_err(error)?;
                let mut bytes = Vec::with_capacity(max.min(size.saturating_sub(position) as usize));
                file.take(max as u64)
                    .read_to_end(&mut bytes)
                    .map_err(error)?;
                Ok(Some((size, bytes)))
            }
        }
    }
}

/// A received file counts only once its own sender's transfer finished verification.
async fn source(
    state: &DesktopState,
    room: Uuid,
    peer: &str,
    id: Uuid,
) -> Reply<Option<VideoSource>> {
    if let Ok(client) = node(state).await?.room_node(room) {
        if client.read_offered_file(id, 0, 0).map_err(error)?.is_some() {
            return Ok(Some(VideoSource::Offered(client)));
        }
    }
    let account = vault(state).await?;
    let Some(record) = account
        .get::<TransferRecord>(&format!("desktop_transfer/{room}/{id}/{peer}"))
        .map_err(error)?
        .filter(|record| record.status == "received")
    else {
        return Ok(None);
    };
    Ok(account
        .get::<PathBuf>(&format!("desktop_download/{room}/{id}"))
        .map_err(error)?
        .map(|path| VideoSource::Download {
            path,
            size: record.total,
        }))
}

async fn read(
    source: VideoSource,
    id: Uuid,
    position: u64,
    max: usize,
) -> Reply<Option<(u64, Vec<u8>)>> {
    tauri::async_runtime::spawn_blocking(move || source.read(id, position, max))
        .await
        .map_err(error)?
}

/// `None` leaves the message as a plain file card.
#[tauri::command]
pub async fn chat_video_info(
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
) -> Reply<Option<ChatVideoInfo>> {
    let Some(source) = source(&state, room, &peer, id).await? else {
        return Ok(None);
    };
    let Ok(Some((size, prefix))) = read(source, id, 0, VIDEO_SNIFF_LEN).await else {
        return Ok(None);
    };
    Ok(video_mime(&prefix).map(|mime| ChatVideoInfo {
        size,
        mime,
        too_large: size > MAX_VIDEO_PREVIEW,
    }))
}

#[tauri::command]
pub async fn chat_video_chunk(
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
    offset: u64,
) -> Reply<tauri::ipc::Response> {
    let source = source(&state, room, &peer, id)
        .await?
        .ok_or("This video is no longer available")?;
    let (size, bytes) = read(source, id, offset, VIDEO_CHUNK)
        .await?
        .ok_or("This video is no longer available")?;
    if size > MAX_VIDEO_PREVIEW {
        return Err("This video is too large to play in chat".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}
