//! Run: cargo run --example async_basics
use std::time::Instant;
use tokio::time::{Duration, sleep};

async fn job(name: &'static str) -> &'static str {
    println!("{name}: started");
    sleep(Duration::from_millis(300)).await;
    println!("{name}: finished");
    name
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let not_started = job("lazy");
    println!("Created a future; its body has not run yet.");
    not_started.await;

    let start = Instant::now();
    job("sequential A").await;
    job("sequential B").await;
    println!("sequential: {:?}", start.elapsed());

    let start = Instant::now();
    let (a, b) = tokio::join!(job("joined A"), job("joined B"));
    println!("join: {a}, {b}, {:?}", start.elapsed());

    let handle = tokio::spawn(async move { job("spawned").await });
    println!("The spawned task can progress before we await its handle.");
    println!("task result: {}", handle.await?);
    Ok(())
}
