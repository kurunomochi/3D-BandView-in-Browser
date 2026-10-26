(() => {
  const { esc, url, ordered, minutes, card, blocks } = Journal;
  const id = new URLSearchParams(location.search).get("id");
  const title = document.querySelector("#article-title");
  const meta = document.querySelector("#article-meta");
  const excerpt = document.querySelector("#article-excerpt");
  const body = document.querySelector("#article-body");
  const toc = document.querySelector("#article-toc");
  const save = document.querySelector("#save-post");
  let headings = [];
  function inline(parent, text) {
    // Only text nodes and explicitly created elements: raw HTML is never interpreted.
    const pattern = /(https?:\/\/[^\s<>"']+|`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(last, match.index)));
      const token = match[0];
      let node;
      if (token.startsWith("http")) {
        node = document.createElement("a");
        node.textContent = token;
        node.href = token;
        node.target = "_blank";
        node.rel = "noreferrer noopener";
      } else {
        const code = token.startsWith("`");
        node = document.createElement(code ? "code" : "strong");
        node.textContent = token.slice(code ? 1 : 2, code ? -1 : -2);
      }
      parent.append(node);
      last = match.index + token.length;
    }
    parent.append(document.createTextNode(text.slice(last)));
  }
  function renderContent(article) {
    body.replaceChildren();
    toc.replaceChildren();
    headings = [];
    let list = null;
    for (const block of blocks(article.content || [article.excerpt])) {
      if (block.type === "ul" || block.type === "ol") {
        if (!list || list.tagName.toLowerCase() !== block.type) {
          list = document.createElement(block.type);
          body.append(list);
        }
        const li = document.createElement("li");
        inline(li, block.text);
        list.append(li);
        continue;
      }
      list = null;
      if (block.type === "video") {
        const wrap = document.createElement("div");
        wrap.innerHTML = Blog.videoPlayer(block.text, article.title);
        body.append(wrap);
        continue;
      }
      if (block.type === "code") {
        const wrap = document.createElement("div");
        wrap.className = "code-block";
        const bar = document.createElement("div");
        bar.className = "code-toolbar";
        const label = document.createElement("span");
        label.textContent = block.language || "CODE";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "复制代码";
        copy.addEventListener("click", () => Journal.copy(block.text, copy));
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = block.text;
        pre.append(code);
        bar.append(label, copy);
        wrap.append(bar, pre);
        body.append(wrap);
        continue;
      }
      const node = document.createElement(block.type);
      inline(node, block.text);
      if (/^h[2-4]$/.test(block.type)) {
        node.id = `section-${headings.length + 1}`;
        const a = document.createElement("a");
        a.href = `#${node.id}`;
        a.textContent = block.text;
        toc.append(a);
        headings.push({ node, link: a });
      }
      body.append(node);
    }
    if (!headings.length)
      toc.innerHTML = '<a href="#article-content">阅读全文</a>';
    if (/^#section-\d+$/.test(location.hash))
      document.querySelector(location.hash)?.scrollIntoView();
  }
  function progress() {
    if (!body.childElementCount) return;
    const rect = body.getBoundingClientRect();
    const percent = Math.round(
      Math.min(
        1,
        Math.max(0, (window.innerHeight - rect.top) / Math.max(1, rect.height)),
      ) * 100,
    );
    document.querySelector("#reading-progress").style.width = `${percent}%`;
    document.querySelector("#reading-status").textContent =
      `阅读进度 ${percent}%`;
    let active = headings[0];
    for (const item of headings)
      if (item.node.getBoundingClientRect().top <= 180) active = item;
    headings.forEach((item) =>
      item.link.setAttribute("aria-current", String(item === active)),
    );
  }
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          progress();
          ticking = false;
        });
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", progress);
  function savedState() {
    const active = Journal.readSaved().includes(id);
    save.textContent = active ? "已收藏 · 取消" : "收藏文章";
    save.setAttribute("aria-pressed", String(active));
  }
  save.addEventListener("click", () => {
    try {
      Journal.toggleSaved(id);
      savedState();
    } catch {
      Journal.notice("当前浏览器未允许保存收藏，请检查存储设置。");
    }
  });
  window.addEventListener("storage", savedState);
  document
    .querySelector("#share-post")
    .addEventListener("click", (e) =>
      Journal.copy(location.origin + url(id), e.currentTarget),
    );
  const size = document.querySelector("#reading-size");
  function setSize() {
    body.style.setProperty("--reading-size", `${size.value}px`);
    progress();
  }
  try {
    const stored = localStorage.getItem("journal-reading-size");
    if (["17", "19", "21"].includes(stored)) size.value = stored;
  } catch {
    /* Browsing works without storage. */
  }
  size.addEventListener("change", () => {
    setSize();
    try {
      localStorage.setItem("journal-reading-size", size.value);
    } catch {
      Journal.notice("字号已调整，但浏览器未允许记住设置。");
    }
  });
  setSize();
  async function more(article) {
    try {
      const all = ordered(await Blog.request("/api/posts"));
      const index = all.findIndex((p) => p.id === article.id);
      const adjacent = document.querySelector("#adjacent-posts");
      const candidates =
        index >= 0
          ? [
              [all[index - 1], "较新一篇"],
              [all[index + 1], "较早一篇"],
            ]
          : [];
      adjacent.innerHTML = candidates
        .filter(([p]) => p)
        .map(
          ([p, label]) =>
            `<a href="${esc(url(p.id))}"><span>${label}</span><strong>${esc(p.title)}</strong></a>`,
        )
        .join("");
      const related = all
        .filter((p) => p.id !== article.id && p.category === article.category)
        .slice(0, 3);
      document.querySelector("#related-list").innerHTML = related
        .map(card)
        .join("");
      document.querySelector("#related-posts").hidden = !related.length;
    } catch {
      /* The article remains readable if related posts are unavailable. */
    }
  }
  function failure(notFound) {
    title.textContent = notFound ? "这篇文章暂时找不到了" : "文章暂时加载失败";
    excerpt.textContent = notFound
      ? "链接可能有误，或文章已经被移除。可以返回文章页继续浏览。"
      : "请检查网络连接后重试。";
    meta.textContent = notFound ? "404 / ARTICLE NOT FOUND" : "连接未完成";
    body.innerHTML = '<a class="primary-link" href="/blog/">返回全部文章 →</a>';
    if (!notFound) {
      const retry = document.createElement("button");
      retry.className = "soft-button";
      retry.textContent = "重新加载";
      retry.addEventListener("click", () => location.reload());
      body.append(retry);
    }
    toc.textContent = "暂无目录";
    document.querySelector("#reading-status").textContent = "";
  }
  async function load() {
    if (!id) {
      failure(true);
      body.setAttribute("aria-busy", "false");
      return;
    }
    try {
      const article = await Blog.request(
        `/api/posts/${encodeURIComponent(id)}`,
      );
      document.title = `${article.title} · kurumochi`;
      document.querySelector('meta[name="description"]').content =
        article.excerpt;
      title.textContent = article.title;
      excerpt.textContent = article.excerpt;
      meta.textContent = `${article.date} · ${article.category} · 约 ${minutes(article)} 分钟`;
      renderContent(article);
      savedState();
      document.querySelector("#reading-tools").hidden = false;
      document.querySelector("#save-hint").hidden = false;
      progress();
      more(article);
    } catch (error) {
      failure(error.status === 404);
    } finally {
      body.setAttribute("aria-busy", "false");
    }
  }
  load();
})();
