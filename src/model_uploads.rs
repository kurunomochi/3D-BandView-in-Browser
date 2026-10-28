//! Bounded, authenticated uploads. Each request holds at most one 8 MiB chunk.
use super::*;
use axum::routing::put;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::OwnedSemaphorePermit;

pub(super) const BLEND_LIMIT: u64 = 1024 * 1024 * 1024;
pub(super) const CHUNK_LIMIT: usize = 8 * 1024 * 1024;
const IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);
const LIFETIME: Duration = Duration::from_secs(6 * 60 * 60);
pub(super) type Uploads = Mutex<HashMap<String, Session>>;
pub(super) struct Session {
    total: u64,
    received: u64,
    format: String,
    directory: PathBuf,
    touched: Instant,
    created: Instant,
    permit: OwnedSemaphorePermit,
}
#[derive(Deserialize)]
struct Start {
    format: String,
    size: u64,
}
#[derive(Deserialize)]
struct Offset {
    offset: u64,
}
pub(super) fn routes() -> Router<SharedState> {
    Router::new()
        .route("/model-upload-sessions", post(start))
        .route("/model-upload-sessions/{id}", put(chunk).delete(cancel))
        .route("/model-upload-sessions/{id}/complete", post(complete))
}
async fn start(
    State(state): State<SharedState>,
    Json(input): Json<Start>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let max = match input.format.as_str() {
        "blend" => BLEND_LIMIT,
        "glb" => LIMIT as u64,
        _ => return Err(AppError::BadRequest("仅支持 .blend 或 .glb 文件".into())),
    };
    if input.size == 0 || input.size > max {
        return Err(AppError::BadRequest(
            ".blend 最大 1 GiB（1024 MiB），GLB 最大 50 MiB".into(),
        ));
    }
    if input.format == "blend" && state.models.worker.is_none() {
        return Err(AppError::Unavailable(
            "未配置 Blender 转换，请自行导出 GLB".into(),
        ));
    }
    let permit = state.models.gate.clone().try_acquire_owned().map_err(|_| {
        AppError::Conflict(
            "另一个模型正在上传或转换，请稍后再试；中断的上传会在 30 分钟后释放".into(),
        )
    })?;
    let id = Uuid::new_v4().to_string();
    let directory = state.models.directory.join(&id);
    fs::create_dir_all(&directory)
        .await
        .map_err(AppError::storage)?;
    state.models.uploads.lock().await.insert(
        id.clone(),
        Session {
            total: input.size,
            received: 0,
            format: input.format,
            directory,
            touched: Instant::now(),
            created: Instant::now(),
            permit,
        },
    );
    let expiry_id = id.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let mut uploads = state.models.uploads.lock().await;
            let Some(session) = uploads.get(&expiry_id) else {
                return;
            };
            if session.touched.elapsed() < IDLE_LIMIT && session.created.elapsed() < LIFETIME {
                continue;
            }
            if let Some(session) = uploads.remove(&expiry_id) {
                let _ = fs::remove_dir_all(&session.directory).await;
            }
            return;
        }
    });
    Ok((
        StatusCode::CREATED,
        Json(
            serde_json::json!({"id": id, "received": 0, "total": input.size, "chunk_bytes": CHUNK_LIMIT}),
        ),
    ))
}
async fn chunk(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Query(input): Query<Offset>,
    request: Request,
) -> Result<Json<serde_json::Value>, AppError> {
    // Serialize before reading the body so concurrent requests cannot allocate many chunks.
    let mut uploads = state.models.uploads.lock().await;
    let session = uploads.get_mut(&id).ok_or(AppError::NotFound)?;
    if session.touched.elapsed() >= IDLE_LIMIT || session.created.elapsed() >= LIFETIME {
        return Err(AppError::BadRequest("上传已过期，请重新选择文件".into()));
    }
    let bytes = tokio::time::timeout(
        Duration::from_secs(300),
        to_bytes(request.into_body(), CHUNK_LIMIT),
    )
    .await
    .map_err(|_| AppError::BadRequest("分片接收超时，请重试".into()))?
    .map_err(|_| AppError::BadRequest("每个分片最多 8 MiB，请重试上传".into()))?;
    let end = input
        .offset
        .checked_add(bytes.len() as u64)
        .ok_or_else(|| AppError::BadRequest("分片偏移无效".into()))?;
    if bytes.is_empty() || end > session.total || input.offset > session.received {
        return Err(AppError::BadRequest("分片长度或顺序无效".into()));
    }
    if input.offset == 0 {
        let valid = if session.format == "blend" {
            bytes.starts_with(b"BLENDER")
                || bytes.starts_with(b"\x1f\x8b")
                || bytes.starts_with(b"\x28\xb5\x2f\xfd")
        } else {
            bytes.starts_with(b"glTF")
        };
        if !valid {
            return Err(AppError::BadRequest("文件头与所选模型格式不符".into()));
        }
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(session.directory.join("upload.part"))
        .await
        .map_err(AppError::storage)?;
    if input.offset < session.received {
        if end > session.received {
            return Err(AppError::Conflict("分片与已上传内容重叠".into()));
        }
        file.seek(std::io::SeekFrom::Start(input.offset))
            .await
            .map_err(AppError::storage)?;
        let mut previous = vec![0; bytes.len()];
        file.read_exact(&mut previous)
            .await
            .map_err(AppError::storage)?;
        if previous != bytes {
            return Err(AppError::Conflict("重试分片内容不一致，请重新上传".into()));
        }
    } else {
        // A failed write can leave a partial tail. Retry from the last confirmed byte.
        file.set_len(session.received)
            .await
            .map_err(AppError::storage)?;
        file.seek(std::io::SeekFrom::Start(session.received))
            .await
            .map_err(AppError::storage)?;
        file.write_all(&bytes).await.map_err(AppError::storage)?;
        file.flush().await.map_err(AppError::storage)?;
        session.received = end;
    }
    session.touched = Instant::now();
    Ok(Json(
        serde_json::json!({"received":session.received,"total":session.total}),
    ))
}
async fn complete(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Job>), AppError> {
    let mut uploads = state.models.uploads.lock().await;
    // The response can be lost after conversion starts; completing again is harmless.
    if let Some((_, job)) = state.models.jobs.lock().await.get(&id) {
        return Ok((StatusCode::ACCEPTED, Json(job.clone())));
    }
    let session = uploads.get(&id).ok_or(AppError::NotFound)?;
    if session.received != session.total {
        return Err(AppError::BadRequest("文件尚未传完".into()));
    }
    let part = session.directory.join("upload.part");
    if session.format == "glb" {
        let bytes = fs::read(&part).await.map_err(AppError::storage)?;
        validate_glb(&bytes).map_err(AppError::BadRequest)?;
    }
    fs::rename(
        part,
        session.directory.join(format!("source.{}", session.format)),
    )
    .await
    .map_err(AppError::storage)?;
    let session = uploads.remove(&id).ok_or(AppError::NotFound)?;
    let job = launch_job(
        state.clone(),
        id,
        session.directory,
        session.format,
        session.permit,
    )
    .await;
    Ok((StatusCode::ACCEPTED, Json(job)))
}
async fn cancel(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut uploads = state.models.uploads.lock().await;
    if let Some(session) = uploads.remove(&id) {
        fs::remove_dir_all(session.directory)
            .await
            .map_err(AppError::storage)?;
    }
    Ok(StatusCode::NO_CONTENT)
}
