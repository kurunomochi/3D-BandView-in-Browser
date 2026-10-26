//! A tiny framed protocol: [4-byte big-endian length][payload].
//! Server: cargo run --example tcp_frames
//! Client: cargo run --example tcp_frames -- client
//! Tests:  cargo test --example tcp_frames
use std::{io, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Semaphore,
    task::JoinSet,
    time::timeout,
};

const MAX_FRAME: usize = 64 * 1024;

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0; 4];
    // Clean EOF before a new header is different from a truncated frame.
    if reader.read(&mut header[..1]).await? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut header[1..]).await?;
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame exceeds 64 KiB",
        ));
    }
    let mut payload = vec![0; length];
    reader.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame exceeds 64 KiB",
        ));
    }
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await?;
    writer.write_all(payload).await
}

async fn connection(mut socket: TcpStream) -> io::Result<()> {
    loop {
        // A deadline for the whole frame, including its body.
        // On timeout we DROP the connection: read_exact may have consumed bytes.
        let frame = timeout(Duration::from_secs(30), read_frame(&mut socket))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "frame timeout"))??;
        let Some(payload) = frame else {
            return Ok(());
        };
        timeout(Duration::from_secs(30), write_frame(&mut socket, &payload))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "write timeout"))??;
    }
}

async fn serve() -> io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:4001").await?;
    let permits = Arc::new(Semaphore::new(32));
    let mut tasks = JoinSet::new();
    println!("Framed echo on 127.0.0.1:4001; Ctrl+C stops the demo.");
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
                    drop(socket);
                    continue;
                };
                tasks.spawn(async move {
                    let _permit = permit;
                    if let Err(error) = connection(socket).await {
                        eprintln!("{peer}: {error}");
                    }
                });
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}

async fn client(address: &str) -> io::Result<()> {
    let mut stream = TcpStream::connect(address).await?;
    for text in ["你好，Rust async", "同一条 TCP 连接上的第二条消息"] {
        write_frame(&mut stream, text.as_bytes()).await?;
        let reply = read_frame(&mut stream)
            .await?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing reply"))?;
        assert_eq!(reply, text.as_bytes());
        println!("Echo: {}", String::from_utf8_lossy(&reply));
    }
    stream.shutdown().await?;
    Ok(())
}

#[tokio::main]
async fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "client") {
        timeout(
            Duration::from_secs(5),
            client(args.get(2).map(String::as_str).unwrap_or("127.0.0.1:4001")),
        )
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "client deadline"))?
    } else {
        serve().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn fragmented_header_and_utf8_payload() {
        // Capacity 1 forces the writer and reader to advance in small pieces.
        let (mut reader, mut writer) = duplex(1);
        let text = "我是 Rust 初学者".as_bytes().to_vec();
        let expected = text.clone();
        let sender = tokio::spawn(async move {
            let packet = [(text.len() as u32).to_be_bytes().to_vec(), text].concat();
            for byte in packet {
                writer.write_all(&[byte]).await.unwrap();
            }
        });
        assert_eq!(read_frame(&mut reader).await.unwrap(), Some(expected));
        assert_eq!(read_frame(&mut reader).await.unwrap(), None);
        sender.await.unwrap();
    }

    #[tokio::test]
    async fn consecutive_frames_and_empty_payload() {
        let (mut reader, mut writer) = duplex(128);
        write_frame(&mut writer, b"first").await.unwrap();
        write_frame(&mut writer, b"").await.unwrap();
        write_frame(&mut writer, b"third").await.unwrap();
        drop(writer);
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(b"first".to_vec())
        );
        assert_eq!(read_frame(&mut reader).await.unwrap(), Some(vec![]));
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(b"third".to_vec())
        );
        assert_eq!(read_frame(&mut reader).await.unwrap(), None);
    }

    #[tokio::test]
    async fn oversized_and_truncated_frames_are_errors() {
        let (mut reader, mut writer) = duplex(32);
        writer
            .write_all(&((MAX_FRAME + 1) as u32).to_be_bytes())
            .await
            .unwrap();
        assert_eq!(
            read_frame(&mut reader).await.unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        let (mut reader, mut writer) = duplex(32);
        writer.write_all(&[0, 0, 0, 5, b'x']).await.unwrap();
        drop(writer);
        assert_eq!(
            read_frame(&mut reader).await.unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[tokio::test]
    async fn real_tcp_round_trip() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            connection(socket).await.unwrap();
        });
        timeout(Duration::from_secs(5), client(&address.to_string()))
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}
