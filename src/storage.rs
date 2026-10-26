use crate::error::AppError;
use serde::{Serialize, de::DeserializeOwned};
use std::path::Path;
use tokio::{fs, io::AsyncWriteExt};

pub async fn load<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, Box<dyn std::error::Error>> {
    match fs::read(path).await {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

// Call with the collection write lock held. Run one process per data directory.
// Keep the previous in-memory state until this atomic replacement succeeds.
pub async fn save<T: Serialize>(path: &Path, values: &[T]) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(values).map_err(AppError::storage)?;
    let temporary = path.with_extension("json.tmp");
    let result = async {
        let mut file = fs::File::create(&temporary).await?;
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        drop(file);
        fs::rename(&temporary, path).await
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result.map_err(AppError::storage)
}
