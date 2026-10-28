use crate::{SharedState, error::AppError};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    fs,
    process::Command,
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

#[path = "model_uploads.rs"]
mod chunked;

const LIMIT: usize = 50 * 1024 * 1024;
const OUTPUT_LIMIT: u64 = 100 * 1024 * 1024;
pub struct ModelService {
    directory: PathBuf,
    worker: Option<PathBuf>,
    gate: Arc<Semaphore>,
    jobs: Mutex<HashMap<String, (Instant, Job)>>,
    uploads: chunked::Uploads,
}
#[derive(Clone, Serialize)]
struct Job {
    id: String,
    status: String,
    message: String,
    url: Option<String>,
}
impl ModelService {
    pub fn new(directory: PathBuf) -> Self {
        let worker = std::env::var_os("BLOG_MODEL_WORKER")
            .map(PathBuf::from)
            .or_else(|| cfg!(target_os = "linux").then(|| PathBuf::from("scripts/model-worker.py")))
            .and_then(|path| path.canonicalize().ok());
        Self {
            directory,
            worker,
            gate: Arc::new(Semaphore::new(1)),
            jobs: Mutex::new(HashMap::new()),
            uploads: Mutex::new(HashMap::new()),
        }
    }
}
pub fn routes() -> Router<SharedState> {
    Router::new()
        .merge(chunked::routes())
        .route("/models/config", get(config))
        .route("/model-jobs/{id}", get(status))
        .route(
            "/model-uploads",
            post(upload).layer(DefaultBodyLimit::max(LIMIT)),
        )
}
async fn config(State(state): State<SharedState>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"blend_available": state.models.worker.is_some(), "max_bytes": LIMIT,
        "blend_max_bytes": chunked::BLEND_LIMIT, "glb_max_bytes": LIMIT, "chunk_bytes": chunked::CHUNK_LIMIT}),
    )
}
pub fn safe_model_url(url: &str) -> bool {
    url.strip_prefix("/uploads/models/")
        .and_then(|s| s.strip_suffix(".glb"))
        .is_some_and(|id| Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id))
}
pub async fn check_model(state: &SharedState, url: &str) -> Result<(), AppError> {
    if !url.is_empty()
        && (!safe_model_url(url)
            || !fs::try_exists(state.uploads_dir.join(url.trim_start_matches("/uploads/")))
                .await
                .map_err(AppError::storage)?)
    {
        return Err(AppError::BadRequest("请先上传并完成 3D 模型转换".into()));
    }
    Ok(())
}
async fn status(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Job>, AppError> {
    state
        .models
        .jobs
        .lock()
        .await
        .get(&id)
        .map(|(_, job)| Json(job.clone()))
        .ok_or(AppError::NotFound)
}
#[derive(Deserialize)]
struct Upload {
    format: String,
}
async fn upload(
    State(state): State<SharedState>,
    Query(input): Query<Upload>,
    request: Request,
) -> Result<(StatusCode, Json<Job>), AppError> {
    if !["blend", "glb"].contains(&input.format.as_str()) {
        return Err(AppError::BadRequest(
            "仅支持 .blend 或独立的 .glb 文件".into(),
        ));
    }
    if input.format == "blend" && state.models.worker.is_none() {
        return Err(AppError::Unavailable(
            "服务器暂未配置 Blender 转换，可先在 Blender 中导出 GLB 上传".into(),
        ));
    }
    let permit = state
        .models
        .gate
        .clone()
        .try_acquire_owned()
        .map_err(|_| AppError::Conflict("另一个模型正在上传或转换，请稍后再试".into()))?;
    let bytes = to_bytes(request.into_body(), LIMIT).await.map_err(|_| {
        AppError::BadRequest("模型上传未完成或超过 50 MB，请检查网络和文件大小".into())
    })?;
    if input.format == "glb" {
        validate_glb(&bytes).map_err(AppError::BadRequest)?;
    } else if !(bytes.starts_with(b"BLENDER")
        || bytes.starts_with(b"\x1f\x8b")
        || bytes.starts_with(b"\x28\xb5\x2f\xfd"))
    {
        return Err(AppError::BadRequest("文件不是有效的 Blender 工程".into()));
    }
    let id = Uuid::new_v4().to_string();
    let directory = state.models.directory.join(&id);
    fs::create_dir_all(&directory)
        .await
        .map_err(AppError::storage)?;
    fs::write(directory.join(format!("source.{}", input.format)), &bytes)
        .await
        .map_err(AppError::storage)?;
    drop(bytes);
    let job = launch_job(state, id, directory, input.format, permit).await;
    Ok((StatusCode::ACCEPTED, Json(job)))
}
async fn launch_job(
    state: SharedState,
    id: String,
    directory: PathBuf,
    format: String,
    permit: tokio::sync::OwnedSemaphorePermit,
) -> Job {
    let job = Job {
        id: id.clone(),
        status: "processing".into(),
        message: "正在准备网页模型，通常需要几秒到两分钟".into(),
        url: None,
    };
    {
        let mut jobs = state.models.jobs.lock().await;
        jobs.retain(|_, (created, _)| created.elapsed() < Duration::from_secs(86400));
        if jobs.len() >= 100
            && let Some(oldest) = jobs
                .iter()
                .min_by_key(|(_, (time, _))| *time)
                .map(|(id, _)| id.clone())
        {
            jobs.remove(&oldest);
        }
        jobs.insert(id.clone(), (Instant::now(), job.clone()));
    }
    tokio::spawn(async move {
        let result = convert(&state, &id, &directory, &format).await;
        let mut jobs = state.models.jobs.lock().await;
        if let Some((_, job)) = jobs.get_mut(&id) {
            match result {
                Ok(url) => {
                    job.status = "ready".into();
                    job.message = "3D 模型已准备好，保存作品后发布".into();
                    job.url = Some(url);
                }
                Err(message) => {
                    job.status = "failed".into();
                    job.message = message;
                }
            }
        }
        drop(permit);
    });
    job
}
async fn convert(
    state: &SharedState,
    id: &str,
    directory: &std::path::Path,
    format: &str,
) -> Result<String, String> {
    let output = if format == "blend" {
        fs::write(
            directory.join("export.py"),
            include_str!("../scripts/export-model.py"),
        )
        .await
        .map_err(|_| "无法准备转换文件".to_string())?;
        let log = std::fs::File::create(directory.join("conversion.log"))
            .map_err(|_| "无法创建转换日志".to_string())?;
        let mut command = Command::new("python3");
        command
            .arg(state.models.worker.as_ref().ok_or("未配置 Blender 转换")?)
            .arg(directory.canonicalize().map_err(|_| "转换目录不可用")?)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C.UTF-8")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|_| "日志不可用")?)
            .stderr(log)
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "无法启动转换程序，请检查服务器配置".to_string())?;
        match tokio::time::timeout(Duration::from_secs(150), child.wait()).await {
            Ok(Ok(exit)) if exit.success() => {},
            Ok(_) => return Err("转换失败：请确认文件能在 Blender 5.2 打开、包含可见网格并已打包贴图；复杂场景请简化后重试，或自行导出 GLB".into()),
            Err(_) => { let _ = child.kill().await; return Err("转换超过 150 秒，已停止。请减少模型面数、修改器或贴图大小后重试".into()); }
        }
        directory.join("model.glb")
    } else {
        directory.join("source.glb")
    };
    let length = fs::metadata(&output)
        .await
        .map_err(|_| "转换没有生成模型")?
        .len();
    if length > OUTPUT_LIMIT {
        return Err("网页模型超过 100 MB，请简化模型和贴图后重试".into());
    }
    let bytes = fs::read(&output).await.map_err(|_| "无法读取转换结果")?;
    validate_glb(&bytes)?;
    let public = state.uploads_dir.join("models");
    fs::create_dir_all(&public)
        .await
        .map_err(|_| "无法创建模型目录")?;
    let temp = public.join(format!("{id}.tmp"));
    fs::write(&temp, &bytes)
        .await
        .map_err(|_| "无法保存网页模型")?;
    fs::rename(temp, public.join(format!("{id}.glb")))
        .await
        .map_err(|_| "无法发布网页模型")?;
    Ok(format!("/uploads/models/{id}.glb"))
}
fn validate_glb(bytes: &[u8]) -> Result<(), String> {
    let invalid = || "GLB 无效，请导出 glTF 2.0 二进制文件并将贴图嵌入其中".to_string();
    if bytes.len() < 20
        || &bytes[..4] != b"glTF"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) != 2
        || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize != bytes.len()
    {
        return Err(invalid());
    }
    let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if &bytes[16..20] != b"JSON"
        || json_len == 0
        || !json_len.is_multiple_of(4)
        || json_len > bytes.len() - 20
    {
        return Err(invalid());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes[20..20 + json_len]).map_err(|_| invalid())?;
    if value["asset"]["version"] != "2.0"
        || !value["meshes"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    {
        return Err("模型中没有可显示的网格，请转换曲线/文字或导出可见网格".into());
    }
    fn embedded(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(fields) => fields.iter().all(|(key, value)| {
                (key != "uri"
                    || value.as_str().is_some_and(|s| {
                        s.starts_with("data:image/")
                            || s.starts_with("data:application/octet-stream;")
                    }))
                    && embedded(value)
            }),
            serde_json::Value::Array(items) => items.iter().all(embedded),
            _ => true,
        }
    }
    if !embedded(&value) {
        return Err("GLB 引用了外部文件，请将所有贴图和缓冲数据嵌入 GLB".into());
    }
    let rest = &bytes[20 + json_len..];
    if !rest.is_empty()
        && (rest.len() < 8
            || &rest[4..8] != b"BIN\0"
            || u32::from_le_bytes(rest[..4].try_into().unwrap()) as usize != rest.len() - 8)
    {
        return Err(invalid());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn glb(value: serde_json::Value) -> Vec<u8> {
        let mut json = serde_json::to_vec(&value).unwrap();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        [
            b"glTF".as_slice(),
            &2u32.to_le_bytes(),
            &((20 + json.len()) as u32).to_le_bytes(),
            &(json.len() as u32).to_le_bytes(),
            b"JSON",
            &json,
        ]
        .concat()
    }
    #[test]
    fn only_complete_embedded_glb_and_owned_urls() {
        let valid = glb(serde_json::json!({"asset":{"version":"2.0"},"meshes":[{}]}));
        assert!(validate_glb(&valid).is_ok());
        for end in 0..valid.len() {
            assert!(validate_glb(&valid[..end]).is_err());
        }
        assert!(validate_glb(&glb(serde_json::json!({"asset":{"version":"2.0"},"meshes":[{}],"images":[{"uri":"https://example.com/a.png"}]}))).is_err());
        assert!(!safe_model_url("/uploads/models/../../a.glb"));
        assert!(!safe_model_url("https://example.com/a.glb"));
        assert!(safe_model_url(
            "/uploads/models/00000000-0000-0000-0000-000000000000.glb"
        ));
    }
}
