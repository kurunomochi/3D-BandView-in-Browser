//! Byte-stream echo server, not an HTTP server.
//! Run: cargo run --example tcp_echo
//! Connect with: cargo run --example tcp_frames -- client 127.0.0.1:4000
use std::{io, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Semaphore,
    task::JoinSet,
    time::timeout,
};

async fn echo(mut stream: TcpStream) -> io::Result<()> {
    let mut buffer = [0_u8; 4096];
    loop {
        // Idle read deadline: it resets after each successful read.
        let n = timeout(Duration::from_secs(30), stream.read(&mut buffer))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "idle connection"))??;
        if n == 0 {
            return Ok(());
        }
        timeout(Duration::from_secs(30), stream.write_all(&buffer[..n]))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "slow reader"))??;
    }
}

#[tokio::main]
async fn main() -> io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:4000").await?;
    let permits = Arc::new(Semaphore::new(32));
    let mut tasks = JoinSet::new();
    println!("Byte echo listening on 127.0.0.1:4000; Ctrl+C stops the demo.");
    loop {
        tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal?;
                break;
            }
            result = tasks.join_next(), if !tasks.is_empty() => {
                if let Some(Err(error)) = result {
                    eprintln!("Task failed: {error}");
                }
            }
            accepted = listener.accept() => {
                let (socket, peer) = accepted?;
                let Ok(permit) = permits.clone().try_acquire_owned() else {
                    // Demo overload policy: close the new connection immediately.
                    drop(socket);
                    continue;
                };
                tasks.spawn(async move {
                    let _permit = permit;
                    if let Err(error) = echo(socket).await {
                        eprintln!("{peer}: {error}");
                    }
                });
            }
        }
    }
    // This demo has no persistent writes; intentionally abort in-flight echoes.
    // A data-writing service needs a drain/commit policy instead.
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}
