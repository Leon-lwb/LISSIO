use super::*;

fn batch(count: usize, channels: usize, timestamp: u64) -> Arc<Vec<DataFrame>> {
    Arc::new(
        (0..count)
            .map(|_| DataFrame {
                timestamp,
                channels: vec![0.0; channels],
            })
            .collect(),
    )
}

#[test]
fn frame_budget_keeps_latest_and_recovers_accounting() {
    let mut queue = FrameQueue::default();
    for i in 0..40 {
        assert_eq!(queue.push(batch(3_500, 4, i)), 0);
    }
    assert_eq!(queue.frames, MAX_FRAMES);
    assert_eq!(queue.push(batch(3_500, 4, 40)), 3_500);
    assert_eq!(queue.pop().unwrap().frames[0].timestamp, 1);
    assert_eq!(queue.clear(), 39 * 3_500);
    assert_eq!((queue.frames, queue.bytes, queue.len()), (0, 0, 0));
}

#[test]
fn wide_channels_and_oversized_batches_respect_byte_budget() {
    let mut queue = FrameQueue::default();
    assert_eq!(queue.push(batch(1_000, 1_024, 0)), 0);
    assert_eq!(queue.push(batch(1_000, 1_024, 1)), 0);
    assert_eq!(queue.push(batch(1_000, 1_024, 2)), 1_000);
    assert!(queue.bytes <= MAX_BYTES);
    assert_eq!(queue.push(batch(3_000, 1_024, 3)), 5_000);
    assert!(queue.is_empty());
    assert_eq!((queue.frames, queue.bytes), (0, 0));
    assert_eq!(
        queue.push(batch(MAX_FRAMES + 1, 0, 4)),
        (MAX_FRAMES + 1) as u64
    );
    assert!(queue.is_empty());
}

#[test]
fn tiny_batches_have_bounded_metadata() {
    let mut queue = FrameQueue::default();
    for i in 0..MAX_BATCHES {
        assert_eq!(queue.push(batch(1, 1, i as u64)), 0);
    }
    assert_eq!(queue.push(batch(1, 1, 256)), 1);
    assert_eq!(queue.len(), MAX_BATCHES);
    assert_eq!(queue.pop().unwrap().frames[0].timestamp, 1);
}

#[test]
fn queued_small_batches_merge_in_order_without_copying_channels() {
    let mut queue = FrameQueue::default();
    let first = batch(3_500, 4, 1);
    let channels_ptr = first[0].channels.as_ptr();
    queue.push(first);
    for i in 2..=5 {
        queue.push(batch(3_500, 4, i));
    }
    let (merged, _, _) = queue.pop_ready().unwrap();
    assert_eq!(merged.len(), 14_000);
    assert_eq!(merged[0].channels.as_ptr(), channels_ptr);
    for (i, chunk) in merged.as_chunks::<3_500>().0.iter().enumerate() {
        assert!(chunk.iter().all(|frame| frame.timestamp == i as u64 + 1));
    }
    assert_eq!(queue.frames, 3_500);
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.pop_ready().unwrap().0[0].timestamp, 5);
    assert_eq!((queue.frames, queue.bytes), (0, 0));
}

#[test]
fn shared_batches_are_not_cloned_mutated_or_reordered() {
    let mut queue = FrameQueue::default();
    let shared = batch(1, 4, 2);
    queue.push(batch(1, 4, 1));
    queue.push(shared.clone());
    queue.push(batch(1, 4, 3));
    assert_eq!(queue.pop_ready().unwrap().0.len(), 1);
    let (second, _, _) = queue.pop_ready().unwrap();
    assert!(Arc::ptr_eq(&second, &shared));
    assert_eq!(shared.len(), 1);
    assert_eq!(queue.pop_ready().unwrap().0[0].timestamp, 3);
    assert_eq!((queue.frames, queue.bytes), (0, 0));
}

#[test]
fn gap_belongs_to_next_retained_batch_not_an_in_flight_batch() {
    let mut queue = FrameQueue::default();
    queue.push(batch(1, 1, 0));
    let (_, _, earlier_gap) = queue.pop_ready().unwrap();
    for i in 1..=257 {
        queue.push(batch(1, 1, i));
    }
    assert!(!earlier_gap);
    let (retained, _, gap) = queue.pop_ready().unwrap();
    assert_eq!(retained[0].timestamp, 2);
    assert!(gap);
    queue.push(batch(1, 1, 258));
    assert!(!queue.pop_ready().unwrap().2);

    // 拒绝的超大批没有可出队项，缺口必须保留到后续可接受批到达。
    queue.push(batch(MAX_FRAMES + 1, 0, 259));
    assert!(queue.pop_ready().is_none());
    queue.push(batch(1, 1, 260));
    assert!(queue.pop_ready().unwrap().2);
}
