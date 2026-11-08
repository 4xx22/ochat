use ochat_core::{ChatNode, StoredMedia, settings::Settings, vault::Vault};
use std::{sync::Arc, time::Duration};
use tokio::time::{sleep, timeout};

fn account(dir: &std::path::Path) -> Arc<Vault> {
    let (vault, _) = Vault::create(&dir.join("account"), "Bob", "testing password 123").unwrap();
    vault
        .put(
            "profile/settings",
            &Settings {
                relay_enabled: false,
                ..Default::default()
            },
        )
        .unwrap();
    Arc::new(vault)
}

async fn offered(
    alice: &ChatNode,
    bob: &ChatNode,
    dir: &std::path::Path,
    name: &str,
    content: &[u8],
) -> uuid::Uuid {
    let source = dir.join(name);
    tokio::fs::write(&source, content).await.unwrap();
    let offer = alice.offer_file(source).await.unwrap();
    timeout(Duration::from_secs(5), async {
        while bob.incoming_offer(&alice.id(), offer.id).is_err() {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    offer.id
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn accepted_video_is_stored_encrypted_and_readable_after_the_room_is_gone() {
    let temp = tempfile::tempdir().unwrap();
    let vault = account(temp.path());
    let alice = ChatNode::start("Alice", false).await.unwrap();
    let bob = ChatNode::start_with_vault(vault.clone()).await.unwrap();
    let invitation = alice.create_room("Videos", 4).await.unwrap();
    let room = alice.snapshot().room.unwrap().id;
    bob.join(&invitation).await.unwrap();
    timeout(Duration::from_secs(20), async {
        while bob.snapshot().peers.is_empty() {
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();

    let mut content = b"\0\0\0\x18ftypmp42".to_vec();
    content.extend((0..300_000u32).map(|i| (i % 251) as u8));
    let id = offered(&alice, &bob, temp.path(), "clip.mp4", &content).await;
    bob.receive_media(&alice.id(), id).await.unwrap();

    assert!(
        StoredMedia::open(&vault, room, "someone-else", id)
            .unwrap()
            .is_none(),
        "a stored video belongs to the sender that delivered it"
    );
    let stored = StoredMedia::open(&vault, room, &alice.id(), id)
        .unwrap()
        .unwrap();
    let (size, bytes) = stored.read(0, usize::MAX).unwrap();
    assert_eq!(size, content.len() as u64);
    assert_eq!(bytes, content);
    let folder = vault
        .directory()
        .join("received-media")
        .join(room.to_string());
    let file = std::fs::read_dir(&folder)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(
        !std::fs::read(file)
            .unwrap()
            .windows(12)
            .any(|v| v == &content[..12])
    );

    let fake = offered(
        &alice,
        &bob,
        temp.path(),
        "fake.mp4",
        b"<!doctype html><script>alert(1)</script>",
    )
    .await;
    let error = bob.receive_media(&alice.id(), fake).await.unwrap_err();
    assert!(format!("{error:#}").contains("cannot be played in chat"));
    assert!(
        StoredMedia::open(&vault, room, &alice.id(), fake)
            .unwrap()
            .is_none()
    );
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);

    vault.purge_room(room).unwrap();
    assert!(!folder.exists());
    assert!(
        StoredMedia::open(&vault, room, &alice.id(), id)
            .unwrap()
            .is_none()
    );
}
