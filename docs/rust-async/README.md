# 从这个博客学习 Rust 异步工程

打开 **[README.html](README.html)** 阅读完整中文教程。HTML 内嵌样式和交互脚本，不需要联网加载字体或第三方库，可直接双击打开，也可打印成 PDF。

教程以仓库 `5d1e093` 的后端结构为讲解基线；它不假定线上后端已经升级到同一版本。正文包含项目源码摘录、请求流程图、TCP 字节流演示、术语解释、排错方法及分阶段练习。

推荐顺序：

1. 第 1–5 章：项目地图、TCP/HTTP、Future、Tokio、并发。
2. 第 6–10 章：TCP 服务、消息分帧、Axum、共享状态、持久化。
3. 第 11–16 章：错误、取消、背压、生命周期、部署、验证。
4. 第 17–19 章：性能演进、学习任务、自测与词汇表。

在仓库根目录运行配套练习，不需要博客后台密码：

```bash
cargo run --example async_basics
cargo run --example tcp_echo
```

另开终端，用带分帧协议的客户端连接字节回显服务：

```bash
cargo run --example tcp_frames -- client 127.0.0.1:4000
```

体验真正识别消息边界的服务器：

```bash
# 终端一
cargo run --example tcp_frames

# 终端二
cargo run --example tcp_frames -- client
```

退出服务器按 Ctrl+C。示例只监听回环地址，不会修改博客数据；演示服务器退出时会取消正在处理的连接，不代表生产写入服务的停机策略。

```bash
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --example tcp_frames
```

测试覆盖分散到达的帧、UTF-8 字节、多帧连续到达、空消息、超大长度、截断数据，以及真实 TCP 往返。依赖已缓存时可添加 `--offline`。
