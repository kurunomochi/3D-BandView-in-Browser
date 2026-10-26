const $ = (s) => document.querySelector(s);
const esc = Blog.escapeHtml;
const client = Blog.adminClient(signedOut);
const api = (path, options) => client.request(path, options);
let works = [],
  editing = null,
  images = [],
  cover = "",
  model = "",
  uploading = false;
const editor = $("#editor");
function message(id, text) {
  $(id).textContent = text;
}
function signedOut() {
  client.clearToken();
  $("#dashboard").hidden = true;
  $("#login-panel").hidden = false;
}
async function load() {
  works = await api("/api/works");
  $("#work-list").innerHTML = works.length
    ? works
        .map(
          (w) =>
            `<article class="studio-row">${Blog.mediaPreview(w.cover, w.title)}<div class="row-copy"><h3>${esc(w.title)} ${w.featured ? "· 精选" : ""}</h3><p>${esc(w.category)} · ${esc(w.date)}</p></div><div class="studio-actions"><a class="btn secondary" href="/work.html?id=${encodeURIComponent(w.id)}" target="_blank" rel="noopener">查看</a><button class="btn secondary" type="button" data-edit="${esc(w.id)}">编辑</button><button class="btn secondary" type="button" data-delete="${esc(w.id)}">删除</button></div></article>`,
        )
        .join("")
    : '<p class="empty">还没有作品，上传你的第一件图片或视频作品吧。</p>';
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () => edit(works.find((w) => w.id === b.dataset.edit))),
    );
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (uploading) {
          message("#dashboard-message", "请等待媒体上传完成");
          return;
        }
        if (!confirm("确定删除这件作品？原始上传文件将保留。")) return;
        b.disabled = true;
        try {
          await api("/api/works/" + encodeURIComponent(b.dataset.delete), {
            method: "DELETE",
          });
          if (editing === b.dataset.delete) editor.hidden = true;
          await load();
          message("#dashboard-message", "作品已删除");
        } catch (e) {
          message("#dashboard-message", e.message);
          b.disabled = false;
        }
      }),
  );
}
async function dashboard() {
  await api("/api/auth/session");
  $("#login-panel").hidden = true;
  $("#dashboard").hidden = false;
  await load();
}
function renderImages() {
  $("#image-list").innerHTML = images
    .map(
      (url, i) =>
        `<div class="image-item">${Blog.isVideo(url) ? Blog.videoPlayer(url, `作品视频 ${i + 1}`) : Blog.mediaPreview(url, `作品图片 ${i + 1}`)}<button type="button" class="${url === cover ? "selected" : ""}" data-cover="${i}">${url === cover ? "✓ 当前封面" : "设为封面"}</button><button type="button" data-remove="${i}">移除</button></div>`,
    )
    .join("");
  $("#image-list")
    .querySelectorAll("[data-cover]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (uploading) return;
          cover = images[+b.dataset.cover];
          renderImages();
        }),
    );
  $("#image-list")
    .querySelectorAll("[data-remove]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (uploading) return;
          const removed = images.splice(+b.dataset.remove, 1)[0];
          if (removed === cover) cover = images[0] || "";
          renderImages();
        }),
    );
}
function edit(work) {
  if (uploading) {
    message("#editor-message", "请等待媒体上传完成");
    return;
  }
  editing = work?.id || null;
  editor.reset();
  images = work ? [...new Set([work.cover, ...work.images])] : [];
  cover = work?.cover || "";
  model = work?.model || "";
  renderModel();
  for (const name of ["title", "category", "date", "software", "description"])
    editor.elements[name].value =
      work?.[name] ||
      (name === "software"
        ? "Blender"
        : name === "date"
          ? new Date().toLocaleDateString("sv-SE")
          : "");
  editor.elements.featured.checked = work?.featured || false;
  $("#editor-title").textContent = work ? "编辑作品" : "新建作品";
  message("#editor-message", "");
  editor.hidden = false;
  renderImages();
  editor.scrollIntoView({ behavior: "smooth" });
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
    });
    client.setToken(data.token);
    e.target.reset();
    message("#login-message", "");
    await dashboard();
  } catch (error) {
    message("#login-message", error.message);
  } finally {
    button.disabled = false;
  }
};
$("#logout").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    signedOut();
  } catch (e) {
    message("#dashboard-message", e.message);
  }
};
$("#new-work").onclick = () => edit();
$("#cancel").onclick = () => {
  editor.hidden = true;
};
$("#add-url").onclick = () => {
  if (uploading) return;
  const url = $("#image-url").value.trim();
  if (!url.startsWith("https://") || !Blog.imageUrl(url)) {
    message(
      "#editor-message",
      "请使用 HTTPS 图片或 MP4 视频地址（视频路径须以 .mp4 结尾）",
    );
    return;
  }
  if (images.length >= 30) {
    message("#editor-message", "最多添加 30 个图片或视频");
    return;
  }
  if (!images.includes(url)) images.push(url);
  cover = cover || url;
  $("#image-url").value = "";
  renderImages();
};
$("#files").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  if (images.length + files.length > 30) {
    message("#editor-message", "每件作品最多 30 个图片或视频");
    return;
  }
  uploading = true;
  $("#save").disabled = true;
  $("#new-work").disabled = true;
  $("#cancel").disabled = true;
  $("#files").disabled = true;
  $("#model-file").disabled = true;
  $("#add-url").disabled = true;
  $("#logout").disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      message(
        "#editor-message",
        `正在上传 ${i + 1} / ${files.length}：${files[i].name}，请勿关闭页面…`,
      );
      const result = await Blog.uploadMedia(client, files[i]);
      images.push(result.url);
      cover = cover || result.url;
      renderImages();
    }
    message("#editor-message", "媒体已上传，保存作品后发布。");
  } catch (error) {
    message("#editor-message", error.message);
  } finally {
    uploading = false;
    $("#save").disabled = false;
    $("#new-work").disabled = false;
    $("#cancel").disabled = false;
    $("#files").disabled = false;
    $("#model-file").disabled = false;
    $("#add-url").disabled = false;
    $("#logout").disabled = false;
    e.target.value = "";
  }
};
editor.onsubmit = async (e) => {
  e.preventDefault();
  if (uploading) return;
  if (!cover) {
    message("#editor-message", "请至少添加一个作品图片或视频");
    return;
  }
  $("#save").disabled = true;
  const data = Object.fromEntries(new FormData(editor));
  data.featured = editor.elements.featured.checked;
  data.cover = cover;
  data.images = images.filter((url) => url !== cover);
  data.model = model;
  try {
    await api(
      editing ? "/api/works/" + encodeURIComponent(editing) : "/api/works",
      {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    editor.hidden = true;
    await load();
    message("#dashboard-message", "作品已保存并发布。");
  } catch (error) {
    message("#editor-message", error.message);
  } finally {
    $("#save").disabled = false;
  }
};
if (client.hasToken())
  dashboard().catch((e) => {
    signedOut();
    message("#login-message", e.message);
  });

async function renderModel() {
  const root = $("#model-preview");
  root
    .querySelector(".model-viewer")
    ?.dispatchEvent(new Event("model-dispose"));
  root.replaceChildren();
  $("#remove-model").hidden = !model;
  message(
    "#model-message",
    model
      ? "3D 模型已准备好，可在下方预览；保存作品后发布。"
      : "可选：为作品增加能旋转和移动视角的 3D 预览。",
  );
  if (!model) return;
  const current = model;
  try {
    const { mountModelViewer } = await import("/model-viewer.js?v=20261025-3d");
    if (current !== model) return;
    const section = document.createElement("section");
    root.replaceChildren(section);
    mountModelViewer(section, current);
  } catch {
    message("#model-message", "模型已保存，但预览组件加载失败。刷新后可重试。");
  }
}
$("#remove-model").onclick = () => {
  if (uploading) return;
  model = "";
  renderModel();
};
$("#model-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file || uploading) return;
  const format = file.name.toLowerCase().split(".").pop();
  if (
    !["blend", "glb"].includes(format) ||
    !file.size ||
    file.size > 50 * 1024 * 1024
  ) {
    message("#model-message", "请选择不超过 50 MB 的 .blend 或 .glb 文件");
    event.target.value = "";
    return;
  }
  uploading = true;
  const controls = [
    ...$("#dashboard").querySelectorAll("button, input, textarea"),
  ];
  const previous = controls.map((element) => element.disabled);
  controls.forEach((element) => (element.disabled = true));
  message("#model-message", `正在上传 ${file.name}，请勿关闭页面…`);
  try {
    let job = await api(`/api/model-uploads?format=${format}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
      signal: AbortSignal.timeout(600000),
    });
    const deadline = Date.now() + 180000;
    while (job.status === "processing") {
      message("#model-message", job.message);
      if (Date.now() > deadline)
        throw new Error("等待转换超时，请稍后重新上传；原作品保持不变。");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = await api("/api/model-jobs/" + encodeURIComponent(job.id));
    }
    if (job.status !== "ready" || !job.url)
      throw new Error(job.message || "转换失败");
    model = job.url;
    if (!cover) {
      cover = "/assets/model-placeholder.svg";
      images.push(cover);
      renderImages();
    }
    await renderModel();
  } catch (error) {
    message(
      "#model-message",
      error.status === 404
        ? "转换任务不存在，服务器可能已重启，请重新上传。"
        : error.message,
    );
  } finally {
    uploading = false;
    controls.forEach((element, i) => (element.disabled = previous[i]));
    event.target.value = "";
  }
};
