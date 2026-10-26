use crate::{SharedState, error::AppError};
use axum::{
    Json,
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::Response,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SESSION_SECONDS: u64 = 12 * 60 * 60;
#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}
#[derive(Serialize)]
pub struct LoginResponse {
    token: String,
}

// Route middleware runs before body extraction, including large image uploads.
pub async fn guard(
    State(state): State<SharedState>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    require_login(&state, request.headers()).await?;
    Ok(next.run(request).await)
}
pub async fn session() -> StatusCode {
    StatusCode::NO_CONTENT
}
pub async fn login(
    State(state): State<SharedState>,
    Json(input): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let mut attempts = state.login_attempts.lock().await;
    attempts.retain(|time| time.elapsed().as_secs() < 60);
    if attempts.len() >= 10 {
        return Err(AppError::TooManyRequests);
    }
    attempts.push(std::time::Instant::now());
    drop(attempts);
    if input.username != state.admin_username || input.password != state.admin_password {
        return Err(AppError::Unauthorized);
    }

    let token = Uuid::new_v4().to_string();
    let mut sessions = state.sessions.write().await;
    sessions.retain(|(_, time)| time.elapsed().as_secs() < SESSION_SECONDS);
    if sessions.len() >= 20 {
        sessions.remove(0);
    }
    sessions.push((token.clone(), std::time::Instant::now()));
    Ok(Json(LoginResponse { token }))
}

async fn require_login(state: &SharedState, headers: &HeaderMap) -> Result<(), AppError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(AppError::Unauthorized)?;
    if state
        .sessions
        .read()
        .await
        .iter()
        .any(|(item, time)| item == token && time.elapsed().as_secs() < SESSION_SECONDS)
    {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

pub async fn logout(State(state): State<SharedState>, headers: HeaderMap) -> StatusCode {
    if let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        state
            .sessions
            .write()
            .await
            .retain(|(item, _)| item != token);
    }
    StatusCode::NO_CONTENT
}
