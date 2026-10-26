use crate::{SharedState, error::AppError, storage};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn public_routes() -> Router<SharedState> {
    Router::new()
        .route("/posts", get(list_posts))
        .route("/posts/{id}", get(get_post))
}
pub fn protected_routes() -> Router<SharedState> {
    Router::new()
        .route("/posts", post(create_post))
        .route("/posts/{id}", put(update_post).delete(delete_post))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Post {
    id: String,
    date: String,
    category: String,
    title: String,
    excerpt: String,
    image: String,
    content: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PostInput {
    date: String,
    category: String,
    title: String,
    excerpt: String,
    image: String,
    content: Vec<String>,
}

async fn list_posts(State(state): State<SharedState>) -> Json<Vec<Post>> {
    Json(state.posts.read().await.clone())
}

async fn get_post(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Post>, AppError> {
    let posts = state.posts.read().await;
    posts
        .iter()
        .find(|post| post.id == id)
        .cloned()
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn create_post(
    State(state): State<SharedState>,
    Json(input): Json<PostInput>,
) -> Result<(StatusCode, Json<Post>), AppError> {
    validate_post(&input)?;
    let post = Post {
        id: Uuid::new_v4().to_string(),
        date: input.date,
        category: input.category,
        title: input.title,
        excerpt: input.excerpt,
        image: input.image,
        content: input.content,
    };
    let mut posts = state.posts.write().await;
    let mut updated = posts.clone();
    updated.push(post.clone());
    storage::save(&state.data_file, &updated).await?;
    *posts = updated;
    Ok((StatusCode::CREATED, Json(post)))
}

async fn update_post(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(input): Json<PostInput>,
) -> Result<Json<Post>, AppError> {
    validate_post(&input)?;
    let mut posts = state.posts.write().await;
    let mut updated = posts.clone();
    let post = updated
        .iter_mut()
        .find(|post| post.id == id)
        .ok_or(AppError::NotFound)?;
    post.date = input.date;
    post.category = input.category;
    post.title = input.title;
    post.excerpt = input.excerpt;
    post.image = input.image;
    post.content = input.content;
    let response = post.clone();
    storage::save(&state.data_file, &updated).await?;
    *posts = updated;
    Ok(Json(response))
}

async fn delete_post(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut posts = state.posts.write().await;
    let updated: Vec<_> = posts.iter().filter(|post| post.id != id).cloned().collect();
    if updated.len() == posts.len() {
        return Err(AppError::NotFound);
    }
    storage::save(&state.data_file, &updated).await?;
    *posts = updated;
    Ok(StatusCode::NO_CONTENT)
}
fn validate_post(input: &PostInput) -> Result<(), AppError> {
    if input.title.trim().is_empty() || input.excerpt.trim().is_empty() {
        return Err(AppError::BadRequest("标题和摘要不能为空".to_string()));
    }
    if input.content.is_empty() {
        return Err(AppError::BadRequest("正文至少需要一段内容".to_string()));
    }
    if input.title.len() > 300
        || input.excerpt.len() > 4000
        || input.category.trim().is_empty()
        || input.category.len() > 80
        || input.date.len() > 32
        || input.content.len() > 2000
        || input.content.iter().map(String::len).sum::<usize>() > 1_000_000
        || input
            .content
            .iter()
            .all(|paragraph| paragraph.trim().is_empty())
        || (!input.image.is_empty()
            && !crate::works::safe_image(&input.image)
            && !crate::works::safe_image(&format!("/{}", input.image)))
    {
        return Err(AppError::BadRequest(
            "文章内容超出限制或图片路径无效".into(),
        ));
    }
    Ok(())
}
