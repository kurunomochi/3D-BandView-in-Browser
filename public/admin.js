const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const postList = document.querySelector("#post-list");
const postForm = document.querySelector("#post-form");
const editorTitle = document.querySelector("#editor-title");
const client = Blog.adminClient(signedOut);
const request = (path, options) => client.request(path, options);
let editingId = null;
let posts = [];
let uploading = false;

function setMessage(element, message) {
  element.textContent = message;
}

function signedOut() {
  client.clearToken();
  dashboard.hidden = true;
  loginPanel.hidden = false;
  setMessage(loginMessage, "请重新登录");
}
async function showDashboard() {
  await request("/api/auth/session");
  loginPanel.hidden = true;
  dashboard.hidden = false;
  await loadPosts();
}

function renderPosts() {
  postList.innerHTML = posts
    .map(
      (post) => `
    <article class="post-row">
      <div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.date)} · ${escapeHtml(post.category)} · ${escapeHtml(post.id)}</p></div>
      <div class="row-actions"><button type="button" data-edit="${escapeHtml(post.id)}">编辑</button><button class="secondary" type="button" data-delete="${escapeHtml(post.id)}">删除</button></div>
    </article>
  `,
    )
    .join("");
  postList
    .querySelectorAll("[data-edit]")
    .forEach((button) =>
      button.addEventListener("click", () => startEdit(button.dataset.edit)),
    );
  postList
    .querySelectorAll("[data-delete]")
    .forEach((button) =>
      button.addEventListener("click", () => removePost(button.dataset.delete)),
    );
}

const escapeHtml = Blog.escapeHtml;

async function loadPosts() {
  try {
    posts = await request("/api/posts");
    renderPosts();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  }
}

function startEdit(id) {
  if (uploading) return;
  const post = posts.find((item) => item.id === id);
  if (!post) return;
  editingId = id;
  editorTitle.textContent = "编辑文章";
  for (const [name, value] of Object.entries({
    ...post,
    content: post.content.join("\n"),
  })) {
    if (postForm.elements[name]) postForm.elements[name].value = value;
  }
  postForm.hidden = false;
  postForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startCreate() {
  if (uploading) return;
  editingId = null;
  editorTitle.textContent = "新建文章";
  postForm.reset();
  postForm.elements.image.value = "assets/cover-featured.svg";
  postForm.hidden = false;
  postForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function removePost(id) {
  if (uploading) return;
  if (!confirm("确定删除这篇文章吗？")) return;
  try {
    await request(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    setMessage(dashboardMessage, "文章已删除");
    await loadPosts();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  const data = Object.fromEntries(new FormData(loginForm));
  try {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    client.setToken(result.token);
    loginForm.reset();
    setMessage(loginMessage, "");
    await showDashboard();
  } catch (error) {
    setMessage(loginMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (uploading) return;
  const button = postForm.querySelector("button[type=submit]");
  button.disabled = true;
  const data = Object.fromEntries(new FormData(postForm));
  data.content = data.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    const path = editingId
      ? `/api/posts/${encodeURIComponent(editingId)}`
      : "/api/posts";
    await request(path, {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    postForm.hidden = true;
    setMessage(dashboardMessage, editingId ? "文章已更新" : "文章已创建");
    await loadPosts();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#new-post").addEventListener("click", startCreate);
document.querySelector("#cancel-edit").addEventListener("click", () => {
  if (uploading) return;
  postForm.hidden = true;
});
document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch (error) {
    setMessage(dashboardMessage, error.message);
    return;
  }
  signedOut();
  setMessage(loginMessage, "");
});

if (client.hasToken())
  showDashboard().catch((error) => {
    signedOut();
    setMessage(loginMessage, error.message);
  });

document
  .querySelector("#post-video")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file || uploading) return;
    const output = document.querySelector("#video-message");
    if (!/\.mp4$/i.test(file.name)) {
      setMessage(output, "请选择 MP4 视频");
      event.target.value = "";
      return;
    }
    const content = postForm.elements.content;
    const start = content.selectionStart,
      end = content.selectionEnd;
    const controls = [...dashboard.querySelectorAll("button, input, textarea")];
    const previous = controls.map((control) => control.disabled);
    uploading = true;
    controls.forEach((control) => (control.disabled = true));
    setMessage(output, `正在上传 ${file.name}，请勿关闭页面…`);
    try {
      const result = await Blog.uploadMedia(client, file);
      content.setRangeText(`\n[video](${result.url})\n`, start, end, "end");
      setMessage(
        output,
        "视频已插入正文，保存文章后发布。可以移动这一行调整视频位置。",
      );
    } catch (error) {
      setMessage(output, error.message);
    } finally {
      uploading = false;
      controls.forEach((control, i) => (control.disabled = previous[i]));
      event.target.value = "";
    }
  });
