const params = new URLSearchParams(window.location.search);
const requestedId = params.get("id");
const metaEl = document.querySelector("#article-meta");
const titleEl = document.querySelector("#article-title");
const excerptEl = document.querySelector("#article-excerpt");
const bodyEl = document.querySelector("#article-body");

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function showNotFound(message) {
  metaEl.textContent = "404  ·  FILE NOT FOUND";
  titleEl.textContent = "这份废料不存在";
  excerptEl.textContent = message;
  bodyEl.innerHTML =
    '<p><a class="read-link" href="index.html#articles">返回文章列表</a></p>';
}

async function init() {
  if (!requestedId) {
    showNotFound("链接中没有文章编号。");
    return;
  }
  try {
    const response = await fetch(
      `/api/posts/${encodeURIComponent(requestedId)}`,
    );
    if (response.status === 404) {
      showNotFound("可能还没有被回收，或者链接已经失效。");
      return;
    }
    if (!response.ok) throw new Error("文章加载失败");
    const article = await response.json();
    document.title = `${article.title} · kurumochi / BLOG`;
    metaEl.textContent = `${article.date}  ·  ${article.category}`;
    titleEl.textContent = article.title;
    excerptEl.textContent = article.excerpt;
    bodyEl.replaceChildren(
      ...(article.content || [article.excerpt]).map((paragraph) => {
        const element = document.createElement(
          paragraph.includes("\n") ? "pre" : "p",
        );
        element.textContent = paragraph;
        return element;
      }),
    );
  } catch (error) {
    showNotFound(error.message);
  }
}

document.querySelector("#current-year").textContent = new Date().getFullYear();
refreshIcons();
init();

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
});
