mod auth;
mod config;
mod error;
mod models;
mod posts;
mod storage;
mod works;

use axum::{
    Json, Router,
    extract::Request,
    http::header,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use std::{path::PathBuf, sync::Arc, time::Instant};
use tokio::{
    fs,
    net::TcpListener,
    sync::{Mutex, RwLock},
};
use tower_http::services::ServeDir;

type SharedState = Arc<AppState>;
struct AppState {
    posts: RwLock<Vec<posts::Post>>,
    works: RwLock<Vec<works::Work>>,
    sessions: RwLock<Vec<(String, Instant)>>,
    login_attempts: Mutex<Vec<Instant>>,
    data_file: PathBuf,
    works_file: PathBuf,
    uploads_dir: PathBuf,
    admin_username: String,
    admin_password: String,
    models: models::ModelService,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::from_env()?;
    if !config.public_dir.join("index.html").is_file() {
        return Err("找不到 public/index.html，请检查工作目录或 BLOG_PUBLIC_DIR".into());
    }
    fs::create_dir_all(&config.data_dir).await?;
    let data_file = config.data_dir.join("posts.json");
    let works_file = config.data_dir.join("works.json");
    let posts = storage::load(&data_file).await?;
    let works = storage::load(&works_file).await?;
    let uploads_dir = config.data_dir.join("uploads");
    fs::create_dir_all(&uploads_dir).await?;
    let state = Arc::new(AppState {
        posts: RwLock::new(posts),
        works: RwLock::new(works),
        sessions: RwLock::new(Vec::new()),
        login_attempts: Mutex::new(Vec::new()),
        data_file,
        works_file,
        uploads_dir: uploads_dir.clone(),
        admin_username: config.username,
        admin_password: config.password,
        models: models::ModelService::new(config.data_dir.join("model-jobs")),
    });
    let protected = Router::new()
        .merge(posts::protected_routes())
        .merge(works::protected_routes())
        .merge(models::routes())
        .route("/auth/session", get(auth::session))
        .route("/auth/logout", post(auth::logout))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::guard));
    let api = Router::new()
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({ "status": "ok" })) }),
        )
        .route("/auth/login", post(auth::login))
        .merge(posts::public_routes())
        .merge(works::public_routes())
        .merge(protected)
        .fallback(|| async { error::AppError::NotFound });
    let app = Router::new()
        .nest("/api", api)
        .nest_service("/uploads", ServeDir::new(uploads_dir))
        .fallback_service(ServeDir::new(config.public_dir))
        .layer(middleware::from_fn(security_headers))
        .with_state(state);
    let listener = TcpListener::bind(config.bind).await?;
    println!("blog server listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn security_headers(request: Request, next: Next) -> Response {
    let api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    headers.insert(
        header::REFERRER_POLICY,
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        if api { "no-store" } else { "no-cache" }.parse().unwrap(),
    );
    response
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("cannot install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("cannot install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
