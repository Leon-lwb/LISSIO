use super::{PanicSignal, SpinBarrier};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[test]
fn repeated_generations_do_not_lose_release() {
    let barrier = Arc::new(SpinBarrier::new(4));
    let broken = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel();
    let mut workers = Vec::new();
    for _ in 0..4 {
        let barrier = barrier.clone();
        let broken = broken.clone();
        let tx = tx.clone();
        workers.push(std::thread::spawn(move || {
            for _ in 0..20_000 {
                barrier.wait(&broken);
                if broken.load(Ordering::Acquire) {
                    return;
                }
            }
            tx.send(()).unwrap();
        }));
    }
    let finished = (0..4).all(|_| rx.recv_timeout(Duration::from_secs(10)).is_ok());
    broken.store(true, Ordering::Release);
    for worker in workers {
        worker.join().unwrap();
    }
    assert!(finished, "屏障不得遗漏代次放行");
}

#[test]
fn panic_releases_waiter_without_all_participants() {
    let barrier = Arc::new(SpinBarrier::new(2));
    let broken = Arc::new(AtomicBool::new(false));
    let barrier_worker = barrier;
    let broken_worker = broken.clone();
    let waiter = std::thread::spawn(move || barrier_worker.wait(&broken_worker));
    let result = std::panic::catch_unwind(|| {
        let _signal = PanicSignal(&broken);
        panic!("模拟协调者提前退出");
    });
    assert!(result.is_err());
    waiter.join().unwrap();
}
