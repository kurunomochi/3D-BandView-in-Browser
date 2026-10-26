use axum::{
    Json,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized,
    NotFound,
    TooManyRequests,
    PayloadTooLarge,
    Conflict(String),
    Unavailable(String),
    Internal,
}
impl AppError {
    pub fn storage(error: impl std::fmt::Display) -> Self {
        eprintln!("Storage error: {error}");
        Self::Internal
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "需要管理员登录".into()),
            Self::NotFound => (StatusCode::NOT_FOUND, "内容不存在".into()),
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::Unavailable(message) => (StatusCode::SERVICE_UNAVAILABLE, message),
            Self::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "图片最大 20 MB，MP4 视频最大 100 MB".into(),
            ),
            Self::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "登录尝试过多，请一分钟后重试".into(),
            ),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "保存失败，请检查服务器日志".into(),
            ),
        };
        let mut response = (status, Json(json!({ "error": message }))).into_response();
        if status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, "60".parse().unwrap());
        }
        response
    }
}
