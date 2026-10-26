use std::{env, net::SocketAddr, path::PathBuf};

pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub public_dir: PathBuf,
    pub username: String,
    pub password: String,
}
impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let password = env::var("BLOG_ADMIN_PASSWORD").map_err(|_| "请设置 BLOG_ADMIN_PASSWORD")?;
        let username = env::var("BLOG_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
        if password.trim().is_empty() || username.trim().is_empty() {
            return Err("管理员账号及密码不能为空".into());
        }
        Ok(Self {
            bind: env::var("BLOG_BIND")
                .unwrap_or_else(|_| "127.0.0.1:3000".into())
                .parse()?,
            data_dir: env::var("BLOG_DATA_DIR")
                .unwrap_or_else(|_| "data".into())
                .into(),
            public_dir: env::var("BLOG_PUBLIC_DIR")
                .unwrap_or_else(|_| "public".into())
                .into(),
            username,
            password,
        })
    }
}
