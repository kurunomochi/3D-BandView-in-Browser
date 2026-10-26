use crate::{SharedState, error::AppError, storage};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use tokio::fs;
use uuid::Uuid;

const IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const VIDEO_LIMIT: usize = 100 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Work {
    pub id: String,
    #[serde(flatten)]
    pub details: WorkInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkInput {
    pub title: String,
    pub category: String,
    pub date: String,
    pub description: String,
    pub cover: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default = "default_software")]
    pub software: String,
    #[serde(default)]
    pub featured: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
}
fn default_software() -> String {
    "Blender".into()
}

pub fn public_routes() -> Router<SharedState> {
    Router::new()
        .route("/works", get(list))
        .route("/works/{id}", get(detail))
}
pub fn protected_routes() -> Router<SharedState> {
    Router::new()
        .route("/works", post(create))
        .route("/works/{id}", put(update).delete(remove))
        .route(
            "/uploads",
            post(upload).layer(DefaultBodyLimit::max(VIDEO_LIMIT)),
        )
}
pub fn safe_image(url: &str) -> bool {
    if url.len() > 2048
        || url.chars().any(|c| c.is_control() || c.is_whitespace())
        || url.contains(['\\', '<', '>', '"', '\''])
        || url.contains("..")
    {
        return false;
    }
    if url.starts_with("/uploads/") || url.starts_with("/assets/") {
        return !url.contains('%') && url.rsplit('/').next().is_some_and(|name| !name.is_empty());
    }
    url.parse::<axum::http::Uri>().is_ok_and(|uri| {
        uri.scheme_str() == Some("https")
            && uri.host().is_some_and(|host| !host.is_empty())
            && uri
                .authority()
                .is_some_and(|authority| !authority.as_str().contains('@'))
    })
}
fn validate(input: &WorkInput) -> Result<(), AppError> {
    if input.title.trim().is_empty()
        || input.title.len() > 200
        || input.category.trim().is_empty()
        || input.category.len() > 80
        || input.description.len() > 30000
        || input.date.len() > 32
        || input.software.len() > 200
        || !safe_image(&input.cover)
        || std::iter::once(&input.cover)
            .chain(&input.images)
            .collect::<std::collections::HashSet<_>>()
            .len()
            > 30
        || input.images.iter().any(|url| !safe_image(url))
        || (!input.model.is_empty() && !crate::models::safe_model_url(&input.model))
    {
        return Err(AppError::BadRequest(
            "请检查标题、分类及媒体路径（站内路径或 HTTPS URL），最多 30 个图片或视频".into(),
        ));
    }
    Ok(())
}
async fn list(State(state): State<SharedState>) -> Json<Vec<Work>> {
    Json(state.works.read().await.clone())
}
async fn detail(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Work>, AppError> {
    state
        .works
        .read()
        .await
        .iter()
        .find(|w| w.id == id)
        .cloned()
        .map(Json)
        .ok_or(AppError::NotFound)
}
async fn create(
    State(state): State<SharedState>,
    Json(input): Json<WorkInput>,
) -> Result<(StatusCode, Json<Work>), AppError> {
    validate(&input)?;
    crate::models::check_model(&state, &input.model).await?;
    let work = Work {
        id: Uuid::new_v4().to_string(),
        details: input,
    };
    let mut works = state.works.write().await;
    let mut updated = works.clone();
    updated.insert(0, work.clone());
    storage::save(&state.works_file, &updated).await?;
    *works = updated;
    Ok((StatusCode::CREATED, Json(work)))
}
async fn update(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(input): Json<WorkInput>,
) -> Result<Json<Work>, AppError> {
    validate(&input)?;
    crate::models::check_model(&state, &input.model).await?;
    let mut works = state.works.write().await;
    let mut updated = works.clone();
    let work = updated
        .iter_mut()
        .find(|w| w.id == id)
        .ok_or(AppError::NotFound)?;
    work.details = input;
    let result = work.clone();
    storage::save(&state.works_file, &updated).await?;
    *works = updated;
    Ok(Json(result))
}
async fn remove(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut works = state.works.write().await;
    let updated: Vec<_> = works.iter().filter(|w| w.id != id).cloned().collect();
    if works.len() == updated.len() {
        return Err(AppError::NotFound);
    }
    storage::save(&state.works_file, &updated).await?;
    *works = updated;
    Ok(StatusCode::NO_CONTENT)
}
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}
async fn upload(
    State(state): State<SharedState>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let extension = if is_mp4(&bytes) {
        "mp4"
    } else {
        if bytes.len() > IMAGE_LIMIT {
            return Err(AppError::PayloadTooLarge);
        }
        image_extension(&bytes).ok_or_else(|| {
            AppError::BadRequest("仅支持 PNG、JPEG、WebP 图片（20 MB）和 MP4 视频（100 MB）".into())
        })?
    };
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    fs::write(state.uploads_dir.join(&filename), &bytes)
        .await
        .map_err(AppError::storage)?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "url": format!("/uploads/{filename}") })),
    ))
}

// Validate ISO BMFF boxes and MP4 brands, rather than trusting the filename/MIME.
// This recognizes the container; browsers still need a supported video codec.
fn is_mp4(bytes: &[u8]) -> bool {
    let mut offset = 0;
    let (mut mp4, mut movie, mut media) = (false, false, false);
    while offset < bytes.len() {
        let remaining = &bytes[offset..];
        if remaining.len() < 8 {
            return false;
        }
        let size = u32::from_be_bytes(remaining[..4].try_into().unwrap());
        let kind = &remaining[4..8];
        let (size, header) = match size {
            0 => (remaining.len(), 8),
            1 if remaining.len() >= 16 => {
                let Ok(size) =
                    usize::try_from(u64::from_be_bytes(remaining[8..16].try_into().unwrap()))
                else {
                    return false;
                };
                (size, 16)
            }
            1 => return false,
            size => (size as usize, 8),
        };
        if size < header || size > remaining.len() {
            return false;
        }
        let payload = &remaining[header..size];
        match kind {
            b"ftyp" => {
                if payload.len() < 8 || !payload.len().is_multiple_of(4) {
                    return false;
                }
                let brands: [&[u8]; 9] = [
                    b"isom", b"iso2", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"M4V ", b"MSNV",
                ];
                mp4 |= brands.contains(&&payload[..4])
                    || payload[8..]
                        .chunks_exact(4)
                        .any(|brand| brands.contains(&brand));
            }
            b"moov" => movie = !payload.is_empty(),
            b"mdat" => media = !payload.is_empty(),
            _ => {}
        }
        offset += size;
    }
    mp4 && movie && media
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mp4_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend(kind);
        bytes.extend(payload);
        bytes
    }

    #[test]
    fn mp4_requires_valid_boxes_brand_and_media() {
        let ftyp = mp4_box(b"ftyp", b"isom\0\0\0\0mp42");
        let moov = mp4_box(b"moov", b"movie");
        let mdat = mp4_box(b"mdat", b"frame");
        let valid = [ftyp.clone(), moov.clone(), mdat.clone()].concat();
        assert!(is_mp4(&valid));
        for end in 0..valid.len() {
            assert!(!is_mp4(&valid[..end]));
        }
        assert!(!is_mp4(&[ftyp.clone(), mdat.clone()].concat()));
        assert!(!is_mp4(&[ftyp, moov.clone()].concat()));
        let avif = mp4_box(b"ftyp", b"avif\0\0\0\0avif");
        assert!(!is_mp4(&[avif, moov.clone(), mdat.clone()].concat()));
        let compatible = mp4_box(b"ftyp", b"xxxx\0\0\0\0isom");
        assert!(is_mp4(&[compatible.clone(), moov.clone(), mdat].concat()));
        let extended = [
            1u32.to_be_bytes().as_slice(),
            b"mdat",
            &17u64.to_be_bytes(),
            b"x",
        ]
        .concat();
        assert!(is_mp4(
            &[compatible.clone(), moov.clone(), extended].concat()
        ));
        let to_end = [0u32.to_be_bytes().as_slice(), b"mdat", b"x"].concat();
        assert!(is_mp4(&[compatible, moov, to_end].concat()));
        assert!(!is_mp4(
            &[
                1u32.to_be_bytes().as_slice(),
                b"mdat",
                &u64::MAX.to_be_bytes()
            ]
            .concat()
        ));
    }
    #[test]
    fn rejects_active_content_and_path_traversal() {
        for url in [
            "javascript:alert(1)",
            "//evil.com/x",
            "/uploads/../posts.json",
            "/assets/a\".png",
            "data:image/svg+xml,x",
            "/uploads/%2e%2e/posts.json",
            "https://",
            "https://user:pass@example.com/a.png",
        ] {
            assert!(!safe_image(url), "{url}");
        }
        assert!(safe_image("/uploads/render.png"));
        assert!(safe_image("https://example.com/render.webp"));
        assert_eq!(image_extension(b"<svg onload='alert(1)'>"), None);
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\n"), Some("png"));
    }
}
