# 3D BandView in Browser

将 Blender 工程变成可以在网页里旋转、缩放和平移的 3D 作品。本仓库是从个人博客项目整理出的可运行版本，保留文章、作品集和管理后台，重点展示 **Rust / Axum / Tokio + Blender + Three.js** 的完整上传与预览流程。

## 先看这里

1. 按下方「快速开始」设置管理员账号并启动服务。
2. 打开 `/studio.html`，新建作品，上传内嵌资源的 GLB，即可本地体验。
3. 如果需要上传 `.blend` 自动转换，再按「Linux 自动转换运行环境」配置 Blender 和 bubblewrap。
4. 上传完成后保存作品，在公开详情页点击「加载 3D 模型」。支持鼠标旋转 / 平移 / 缩放、WASD / 方向键移动、Q/E 升降、六方向按钮及全屏。

这是作品展示工具，当前导出静态网格与当前姿态，不提供 Blender 编辑功能或碰撞漫游。转换后的 GLB 为公开资源，原始 `.blend` 保存在非公开目录。项目不包含生产数据、管理员密码和服务器私钥。

### 核心文件

| 文件                      | 作用                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `src/models.rs`           | 鉴权后上传、大小和 GLB 校验、任务状态、并发限制与异步子进程 |
| `scripts/model-worker.py` | Linux 隔离、资源限制和 Blender 进程启动                     |
| `scripts/export-model.py` | 检查工程资源并导出 GLB                                      |
| `public/model-viewer.js`  | 模型加载、相机控制、六方向移动、全屏与资源释放              |
| `public/studio.js`        | 上传、轮询、后台预览与作品保存                              |
| `tests/integration.mjs`   | 登录、上传、持久化和 API 回归测试                           |

开发记录：[让 Blender 作品在浏览器里转起来](docs/3d-preview-release.md)。原博客仓库：[kurunomochi/blog](https://github.com/kurunomochi/blog)。

---

[![Checks](https://github.com/kurunomochi/3D-BandView-in-Browser/actions/workflows/ci.yml/badge.svg)](https://github.com/kurunomochi/3D-BandView-in-Browser/actions/workflows/ci.yml)

个人博客和 Blender 作品集，使用 **Rust + Axum** 后端与原生 HTML / CSS / JavaScript。无需前端构建，也无需数据库服务；文章和作品写入本地 JSON，上传图片和 MP4 视频保存在磁盘。

**在线网站：[nenumochi.top](https://nenumochi.top/)** · **作品集：[portfolio.html](https://nenumochi.top/portfolio.html)**

![Blender 作品示例](public/assets/works/blue-hour.png)

## 功能

- 首页：个人介绍、最新文章、Blender 作品预览，数量来自实际内容。
- 独立文章页 `/blog/`：全文搜索、分类筛选、日期排序、每页 8 篇、收藏筛选；筛选条件和页码保存在 URL 中。
- 文章阅读：自动目录、阅读进度、预计阅读时间、字号选择、复制链接、代码复制、相邻文章和同分类推荐。
- 归档 `/archive.html` 与关于 `/about.html`：按年浏览记录，了解作者和联系方式。
- 作品集：精选作品、分类和搜索、图片与视频混排、图片放大与视频播放。
- 管理后台：文章与作品增删改、图片 / MP4 上传、文章插入视频、封面和精选设置。
- 交互式 3D：上传 `.blend` 自动转换，或直接上传 `.glb`；作品详情支持旋转、缩放、平移和六方向移动。
- 公共页面：循环静音视频背景、可暂停播放、半透明阅读面板、移动端布局。
- 后端：上传前鉴权、限流登录、会话撤销、内容校验、原子文件替换和优雅停止。

后台入口不显示在公共导航中；管理员直接访问 `/admin.html` 或 `/studio.html`。

### 上传 Blender 模型并交互查看

进入 `/studio.html`，新建或编辑作品，在「3D 模型」区域上传 `.blend` 或 `.glb`（最多 50 MiB）。等提示模型准备完成后保存作品，访客即可在作品详情点击「加载 3D 模型」。无封面时会使用模型占位图，也可以另传渲染图作为封面。

- 左键拖动旋转，右键拖动平移，滚轮缩放；手机使用单指旋转、双指缩放和平移。
- 点击模型画面后，W/A/S/D 或方向键移动，Q 下降、E 上升，R 重置。也可以使用画面下方的六方向按钮、移动速度调节和全屏按钮。
- `.blend` 上传前，在 Blender 中使用「文件 → 外部数据 → 打包资源」，将链接库转为本地数据，并确认场景有可见网格。网页显示当前姿态的静态模型；程序化材质、毛发、体积、模拟和复杂节点需先烘焙或转换，效果不保证与 Cycles 渲染一致。
- `.glb` 需是贴图和缓冲数据均内嵌的 glTF 2.0 二进制文件，不支持外链资源及需额外解码器的压缩扩展。
- 网页 GLB 会公开提供访问；原始 `.blend` 和转换日志保存在非公开的 `data/model-jobs/<任务 ID>/`，不会提供原文件下载。请只上传自己制作或信任的工程。

#### Linux 自动转换运行环境

直接上传 GLB 不需要 Blender。自动转换 `.blend` 另外需要 Python 3、bubblewrap，以及安装到服务用户 `~/.local/opt/blender-5.2.3-linux-x64/` 的官方 Blender 5.2.3 Linux x64 发行包。安装时请核对官方 SHA256，并补齐运行库；可选的用户级运行库目录为 `~/.local/opt/blender-libs/usr/lib64/`。发行包来自 [Blender 官方下载目录](https://download.blender.org/release/Blender5.2/)。

从项目根目录运行时，Linux 自动使用 `scripts/model-worker.py`；也可用 `BLOG_MODEL_WORKER` 指定该脚本的绝对路径。服务用户必须能运行 `bwrap --unshare-all`，并具有读取运行环境和写入数据目录的权限。默认 Docker 镜像和 Windows 开发环境仅支持直接上传 GLB；Docker 中的 `.blend` 转换需要另外部署并验证隔离环境，不能通过关闭沙箱代替。

转换一次只运行一个任务，超时 150 秒，内存地址空间限额 1.5 GiB，单线程，输出最多 100 MiB。进程禁用工程脚本、清空继承环境，并隔离网络和文件系统；隔离环境不可用时转换失败。小内存服务器处理大场景可能失败，应减少面数、贴图大小或自行导出 GLB。转换进度保存在内存中，服务重启后未完成任务需重新上传。

原始文件、日志及未关联作品的模型不会自动删除；请定期备份并检查 `data/model-jobs/` 和 `data/uploads/models/` 的占用，清理前确认作品 JSON 中没有引用对应 GLB。网站数据备份应包含整个 `data/`。

Three.js 固定版本的浏览器资源与 MIT 许可证保存在 `public/vendor/three/`，无需访问第三方 CDN。升级依赖后运行 `npm run vendor:three` 同步资源，并重新验证查看器。相机交互基于 [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)，模型加载使用 [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)。

### 文章阅读与收藏

文章继续使用原来的 `content: string[]` 数据格式，不需要迁移。正文支持 `#` / `##` / `###` 标题、列表、引用、围栏代码块、行内代码、加粗和 HTTP(S) 裸链接；不执行原始 HTML，也不是完整 Markdown 引擎。旧文章中的简短独立小标题会自动进入目录。后台输入标题时推荐显式使用 `#`，以保证目录准确。

收藏与字号仅保存在当前浏览器的 localStorage，不会跨设备同步；存储不可用时仍能正常阅读。首页旧的 `#articles` 链接会跳转到 `/blog/`。文章 URL 保持 `/article.html?id=...`，已有分享链接继续可用。

列表搜索目前由浏览器对 `/api/posts` 返回的文章执行，适用于个人博客规模。文章数量明显增长后，应改为后端分页和全文索引，避免每次传输所有正文。

## 快速开始

准备 Rust stable（支持 edition 2024）和 Git。Node.js 22+ 仅用于测试，不是运行网站的必要依赖。

```bash
git clone https://github.com/kurunomochi/3D-BandView-in-Browser.git
cd 3D-BandView-in-Browser
```

Linux / macOS（Bash）：

```bash
export BLOG_ADMIN_USERNAME=admin
read -rsp '后台密码: ' BLOG_ADMIN_PASSWORD; echo
export BLOG_ADMIN_PASSWORD
cargo run --locked
```

Windows（PowerShell）：

```powershell
$env:BLOG_ADMIN_USERNAME = 'admin'
$credential = Get-Credential -UserName admin -Message '设置本次启动的后台密码'
$env:BLOG_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
cargo run --locked
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，再进入 `/admin.html` 或 `/studio.html` 添加内容。首次运行是空站，不会自动写入示例文章。账号密码来自环境变量，没有默认密码。

本仓库不包含生产文章、生产作品清单或上传目录。已有网站升级时，保留自己的 `data/`。

### 环境变量

| 变量                  | 默认值           | 用途                                   |
| --------------------- | ---------------- | -------------------------------------- |
| `BLOG_ADMIN_USERNAME` | `admin`          | 管理员账号，不能为空                   |
| `BLOG_ADMIN_PASSWORD` | 无，必填         | 非空密码，建议使用至少 12 位的随机密码 |
| `BLOG_BIND`           | `127.0.0.1:3000` | 监听 IP 和端口                         |
| `BLOG_DATA_DIR`       | `data`           | 可写的数据目录                         |
| `BLOG_PUBLIC_DIR`     | `public`         | 静态资源目录，须包含 `index.html`      |

相对路径以进程工作目录为基准。`cargo run` 不会自动读取 `.env`；Docker Compose 和示例 systemd 服务会读取它。配置错误或 JSON 损坏时，服务启动失败并保留原文件，不用空数据覆盖。

## 项目结构

```text
src/
  main.rs          路由组装、安全响应头、优雅停止
  config.rs        环境配置及启动校验
  auth.rs          登录、会话、鉴权中间件
  error.rs         统一业务错误响应
  storage.rs       JSON 读写、刷盘和原子替换
  posts.rs         文章接口及校验
  works.rs         作品接口、图片 / 视频上传及校验
public/
  common.js        请求、登录状态、文本转义、媒体 URL 校验与播放器
  index.html       博客首页
  article.html     文章详情
  portfolio.html   作品集
  work.html        作品详情
  admin.html       文章管理
  studio.html      作品管理
  season-theme.*   公共视频主题和透明度变量
  assets/          头像及作品示例图
  media/           视频背景
tests/             API 集成测试、前端公共逻辑测试
deploy/            systemd、Nginx、Apache 配置示例
.github/workflows/ Windows / Linux 自动检查
```

前端脚本按页面加载，共用 `common.js`。博客页面仍使用 Google Fonts 和 Lucide CDN；字体不可用时回退到系统字体，图标加载失败不影响文章和后台接口。

## 修改外观与内容

文章在 `/admin.html` 编辑；目前按行保存为正文段落，纯文本输出，不执行 HTML。`image` 字段为兼容旧数据而保留，公共文章列表和详情不显示封面。

作品在 `/studio.html` 编辑；上传图片或 MP4 视频，也可以填写 HTTPS 媒体地址，设置封面后保存。视频可以作为封面，也可以和图片混排；首页与作品集显示视频预览，详情页提供播放、音量、进度拖动与全屏控件。外链视频 URL 的路径须以 `.mp4` 结尾（可带查询参数），站内媒体可使用 `/assets/…`、`/uploads/…`。

### 上传和发布视频

1. Blender 导出时选择 **MPEG-4 容器 + H.264 视频编码**，有音轨时使用 AAC，建议开启 fast start。只改文件扩展名不能转换编码；服务器不进行转码。
2. 在 `/studio.html` 上传作品视频，或在 `/admin.html` 编辑文章时使用「插入视频」。文章会在正文光标处插入独立的 `[video](/uploads/文件名.mp4)` 行，移动这一行即可调整位置，也支持 HTTPS MP4 直链。
3. 上传成功后仍需点击「保存作品」或「保存文章」才会发布。批量上传中部分失败时，已成功上传的文件仍保留在编辑器中，可以保存或移除。

图片最大 **20 MiB**，视频最大 **100 MiB**（界面简写为 MB），作品最多 30 个媒体文件。上传需要管理员登录；客户端为视频上传留出 10 分钟，不支持断点续传。播放器不自动播放，使用 `preload="metadata"`；不支持编码时可通过下方链接打开原文件。后端支持 `video/mp4` MIME、HEAD 和 HTTP Range 分段读取，允许拖动进度。

媒体继续存放在原来的 `cover`、`images` 字段及 `data/uploads/` 中，无需迁移旧数据。MP4 校验包括容器品牌和顶层 box 边界、moov / mdat 存在性；不保证文件内所有帧或编码可解码。上传请求有硬性大小限制，但会在内存中缓冲整个文件；适用于单人管理的博客，大规模上传需改用流式存储或对象存储。

将背景视频替换为 `public/media/blog-background.mp4`，推荐压缩后的 H.264 MP4。页面默认静音循环播放，切到后台标签页会暂停，返回后继续；用户手动暂停后不会自动恢复。浏览器禁止自动播放时可点击右下角按钮。

透明度集中在 `public/season-theme.css` 顶部：

```css
--surface: rgba(250, 252, 248, 0.72); /* 普通面板 */
--surface-reading: rgba(250, 252, 248, 0.76); /* 文章列表和介绍 */
--surface-detail: rgba(250, 252, 248, 0.86); /* 详情正文 */
--surface-nav: rgba(250, 252, 248, 0.84); /* 导航 */
--surface-menu: rgba(250, 252, 248, 0.96); /* 手机菜单 */
```

最后一个数值越大越不透明。更新静态文件后，修改 HTML 引用中的 `?v=` 版本值；若用了 CDN，再刷新对应资源缓存。

## 数据、认证与限制

- `data/posts.json`：文章数组；`data/works.json`：作品数组；`data/uploads/`：上传图片与视频。文件不存在视为空集合，首次保存时创建。
- 写入在集合锁内进行：先写同目录临时文件、`sync_all`，再重命名替换；写入失败不会修改内存中的内容。**同一数据目录只支持一个进程**，不支持多副本共享 JSON。
- 备份整个数据目录。需要一致快照时暂停后台写入或停止服务；上传目录和两个 JSON 文件一起恢复。原子替换不能替代备份。
- 登录令牌存放在浏览器 `sessionStorage`，最长 12 小时，最多 20 个会话；退出后撤销，服务重启后全部失效。生产通过 HTTPS 访问。
- 登录全站共享每分钟 10 次的尝试额度，超限返回 `429` 和 `Retry-After: 60`，适合单人管理站点。
- PNG / JPEG / WebP 按文件头识别，单张最多 **20 MiB**；MP4 视频最多 **100 MiB**，每件作品最多 **30 个不同媒体文件（含封面）**。不做转码或完整解码；上传前自行压缩。
- 删除作品或移除图片引用不会删除原始文件，避免破坏共享引用；未使用图片可在备份后人工清理。
- JSON 请求默认上限 2 MiB。文章标题、摘要、正文分别最多 300 / 4000 / 1,000,000 UTF-8 字节，正文最多 2000 段；作品标题最多 200 字节、描述最多 30000 字节。
- API 响应使用 `no-store`；静态文件使用 `no-cache`，允许客户端重新验证。内部存储错误只写服务器日志。

## API

管理请求使用 `Authorization: Bearer <token>`。正常读请求返回 `200`，创建返回 `201`，删除和会话检查返回 `204`。

| 方法               | 路径                | 登录     | 说明                                              |
| ------------------ | ------------------- | -------- | ------------------------------------------------- |
| GET                | `/api/health`       | 否       | 健康检查                                          |
| POST               | `/api/auth/login`   | 否       | JSON `{username,password}`，返回 `{token}`        |
| GET                | `/api/auth/session` | 是       | 检查当前会话                                      |
| POST               | `/api/auth/logout`  | 是       | 撤销当前令牌                                      |
| GET / POST         | `/api/posts`        | 写入需要 | 文章列表 / 创建                                   |
| GET / PUT / DELETE | `/api/posts/{id}`   | 写入需要 | 文章详情 / 更新 / 删除                            |
| GET / POST         | `/api/works`        | 写入需要 | 作品列表 / 创建                                   |
| GET / PUT / DELETE | `/api/works/{id}`   | 写入需要 | 作品详情 / 更新 / 删除                            |
| POST               | `/api/uploads`      | 是       | 原始图片或 MP4 字节，返回 `{url}`；不是 multipart |

文章字段：`title, date, category, excerpt, image, content: string[]`。作品字段：`title, date, category, description, cover, images: string[], software, featured`。创建时由服务器生成 `id`，更新使用完整对象。

业务错误返回 `{ "error": "说明" }`。非法 JSON、错误 Content-Type、请求超大等框架级错误可能是纯文本；客户端应先检查状态码。

## Linux 部署

两种方式二选一，均通过反向代理提供 HTTPS。已有站点先备份数据和代理配置，发布代码时保留 `data/` 和 `.env`。

### Docker Compose

在仓库目录执行：

```bash
cp .env.example .env
chmod 600 .env
# 编辑 .env，填写自己的 BLOG_ADMIN_PASSWORD
mkdir -p data
sudo chown -R 10001:10001 data
docker compose up -d --build
curl -f http://127.0.0.1:3001/api/health
```

容器使用 UID/GID `10001`，只读根文件系统，数据目录单独挂载。端口仅暴露到服务器回环地址 `127.0.0.1:3001`。查看日志：`docker compose logs -f --tail=100`。

### 原生二进制 + systemd

以下示例使用 `/opt/blog` 和专用 `blog` 用户。目录或用户名不同，需同步调整服务文件。由部署账号在 Linux 上构建：

```bash
cargo build --locked --release
sudo useradd --system --no-create-home --shell /usr/sbin/nologin blog
sudo mkdir -p /opt/blog
sudo install -d /opt/blog/target/release
sudo install -m 755 target/release/blog /opt/blog/target/release/blog
sudo cp -a public /opt/blog/
sudo install -m 600 .env.example /opt/blog/.env
# 编辑 /opt/blog/.env，填写后台密码
sudo install -d -o blog -g blog -m 700 /opt/blog/data
sudo cp deploy/portfolio.service /etc/systemd/system/blog.service
sudo systemctl daemon-reload
sudo systemctl enable --now blog
curl -f http://127.0.0.1:3001/api/health
```

仅在首次安装时复制 `.env.example`。更新时只替换二进制和 `public/`，保留数据与配置，然后 `sudo systemctl restart blog`。查看日志：`journalctl -u blog -n 100 --no-pager`。

### HTTPS 反向代理

Nginx：将 `deploy/nginx-locations.conf` 中的内容放入已有 HTTPS `server`，检查 `sudo nginx -t` 后再 reload。

Apache：启用 `proxy` / `proxy_http`，将 `deploy/apache-proxy.conf` 放入已有 HTTPS `VirtualHost`，执行 `sudo apachectl configtest` 后再 reload。

示例代理整个站点到端口 3001，博客、作品集与 API 共用后端；不要和旧的 `/api/` 路由同时生效。证书和域名由服务器现有配置管理。代理或 CDN 的上传限制也需要允许 **100 MiB（104857600 字节）** 请求；100 MB 的十进制限制略小于 100 MiB。示例配置已更新为 100 MiB，并延长代理超时。确认代理保留 Range / Content-Range 头，以支持视频进度拖动。

### 升级与回滚

1. 备份 `data/`、`.env`、当前二进制、`public/` 和反向代理配置。
2. 在新目录构建并跑测试，再替换应用文件；保留生产数据路径。
3. 重启后检查健康接口、文章、作品、登录和图片上传。
4. 若需回滚，恢复上一版二进制和静态文件，保留最新数据；只有确实需要数据恢复时才使用备份，并先暂停写入。

这次整理保留旧 JSON 字段和 `/api/` 路径，不需要数据库迁移。

## 开发检查

如果你正在学习 Rust 异步，可以先阅读 **[项目配套异步教程（HTML）](docs/rust-async/README.html)**，或查看 [练习说明](docs/rust-async/README.md)。教程从本项目讲解 TCP、Tokio、Axum、共享状态与持久化，并附带可运行的 TCP 示例。

前端格式工具固定在 `package-lock.json` 中，仅用于开发。先运行 `npm ci --ignore-scripts`，使用 `npm run format` 统一 HTML / CSS / JavaScript 格式。

```bash
npm run format:check
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
node --test tests/frontend.test.mjs
node tests/api-smoke.mjs
```

依赖已缓存时，可给 Cargo 命令添加 `--offline`。集成测试使用系统临时目录和操作系统分配的端口，不读写真实 `data/`；覆盖鉴权顺序、上传限制、增删改、并发写入、磁盘失败回滚、重启持久化、限流和损坏数据保护。GitHub Actions 在 Linux 和 Windows 上执行相同检查。

## 仓库内容

提交网站源码、构建配置和公共媒体；`.gitignore` 排除密码文件、运行数据、编译输出、Blender 工程和本机部署记录。仓库暂未指定开源许可证；作品图片、视频与个人文案的使用请联系作者。
