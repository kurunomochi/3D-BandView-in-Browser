(() => {
  "use strict";
  const esc = Blog.escapeHtml;
  const url = (id) => `/article.html?id=${encodeURIComponent(id)}`;
  function dateKey(value) {
    const m = String(value).match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  }
  function ordered(posts, sort = "newest") {
    return [...posts].sort((a, b) => {
      const result =
        dateKey(b.date).localeCompare(dateKey(a.date)) ||
        String(a.id).localeCompare(String(b.id));
      return sort === "oldest" ? -result : result;
    });
  }
  function minutes(post) {
    return Math.max(1, Math.ceil((post.content || []).join(" ").length / 450));
  }
  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem("journal-saved") || "[]");
      return Array.isArray(value)
        ? value.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  }
  function toggleSaved(id) {
    const saved = new Set(readSaved());
    if (saved.has(id)) saved.delete(id);
    else saved.add(id);
    localStorage.setItem("journal-saved", JSON.stringify([...saved]));
    window.dispatchEvent(new Event("journal-saved"));
    return saved.has(id);
  }
  function select(
    posts,
    {
      query = "",
      category = "",
      savedOnly = false,
      sort = "newest",
      page = 1,
      pageSize = 8,
    } = {},
  ) {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const saved = new Set(readSaved());
    const matches = ordered(
      posts.filter((post) => {
        const text = [
          post.title,
          post.excerpt,
          post.category,
          ...(post.content || []),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return (
          (!category || post.category === category) &&
          (!savedOnly || saved.has(post.id)) &&
          terms.every((term) => text.includes(term))
        );
      }),
      sort,
    );
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
    return {
      matches,
      total: matches.length,
      pages,
      page: current,
      items: matches.slice((current - 1) * pageSize, current * pageSize),
    };
  }
  function card(post) {
    return `<article class="journal-row"><h2><a href="${esc(url(post.id))}">${esc(post.title)}</a></h2><p>${esc(post.excerpt)}</p><div class="journal-meta"><span>${esc(post.date)} · 约 ${minutes(post)} 分钟</span><a class="category-pill" href="/blog/?category=${esc(encodeURIComponent(post.category))}">${esc(post.category)}</a></div></article>`;
  }
  function notice(message) {
    const output = document.querySelector("#site-notice");
    if (output) {
      output.textContent = message;
      output.hidden = false;
    }
  }
  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制";
    } catch {
      notice("浏览器未允许复制，请手动选择内容或复制地址栏链接。");
    }
  }
  function blocks(content) {
    const result = [];
    let code = null,
      language = "";
    for (const line of content.join("\n\n").split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        if (code !== null) {
          result.push({ type: "code", text: code.join("\n"), language });
          code = null;
        } else {
          code = [];
          language = line.trim().slice(3).trim();
        }
        continue;
      }
      if (code !== null) {
        code.push(line);
        continue;
      }
      if (!line.trim()) continue;
      const video = line.trim().match(/^\[video\]\(([^\s]+)\)$/);
      if (video && Blog.isVideo(video[1])) {
        result.push({ type: "video", text: video[1] });
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const list = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
      if (heading)
        result.push({ type: `h${heading[1].length + 1}`, text: heading[2] });
      else if (list)
        result.push({ type: list[1] ? "ul" : "ol", text: list[3] });
      else if (/^>\s?/.test(line))
        result.push({ type: "blockquote", text: line.replace(/^>\s?/, "") });
      // Older posts store section labels as short standalone Chinese paragraphs.
      else if (
        result.length &&
        /^[\p{Script=Han}A-Za-z0-9 +：:、（）“”「」—-]{3,24}$/u.test(
          line.trim(),
        ) &&
        !/[。！？.!?]$/.test(line.trim())
      )
        result.push({ type: "h2", text: line.trim() });
      else result.push({ type: "p", text: line });
    }
    if (code !== null)
      result.push({ type: "code", text: code.join("\n"), language });
    return result;
  }
  window.Journal = {
    esc,
    url,
    dateKey,
    ordered,
    minutes,
    readSaved,
    toggleSaved,
    select,
    card,
    notice,
    copy,
    blocks,
  };
  const menu = document.querySelector("#mobile-menu");
  const toggle = document.querySelector("#menu-toggle");
  function closeMenu() {
    if (!menu || !toggle) return;
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
  }
  toggle?.addEventListener("click", () => {
    const open = menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
  });
  menu
    ?.querySelectorAll("a")
    .forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  document
    .querySelectorAll("[data-year]")
    .forEach((el) => (el.textContent = new Date().getFullYear()));
})();
