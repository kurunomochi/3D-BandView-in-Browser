import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { triangleGlb } from "./model-fixture.mjs";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "blog-test-"));
const password = randomBytes(24).toString("hex");
let child, base;
async function start() {
  child = spawn(
    path.resolve(
      "target/debug/blog" + (process.platform === "win32" ? ".exe" : ""),
    ),
    {
      env: {
        ...process.env,
        BLOG_BIND: "127.0.0.1:0",
        BLOG_DATA_DIR: dataDir,
        BLOG_PUBLIC_DIR: path.resolve("public"),
        BLOG_ADMIN_USERNAME: "admin",
        BLOG_ADMIN_PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let errors = "",
    output = "",
    spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stderr.on("data", (data) => {
    errors += data;
  });
  child.stdout.on("data", (data) => {
    output += data;
  });
  for (let i = 0; i < 150; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error("Server exited: " + errors);
    const address = output.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (address) {
      base = address[0];
      if ((await call("/api/health")).ok) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start: " + errors);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
const call = (url, options = {}) =>
  fetch(base + url, { ...options, signal: AbortSignal.timeout(15000) });
const auth = (token) => ({ Authorization: "Bearer " + token });
const json = (data, token, method = "POST") => ({
  method,
  headers: {
    "Content-Type": "application/json",
    ...(token ? auth(token) : {}),
  },
  body: JSON.stringify(data),
});
async function login() {
  const response = await call(
    "/api/auth/login",
    json({ username: "admin", password }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return (await response.json()).token;
}

try {
  await start();
  for (const page of [
    "/",
    "/article.html",
    "/blog/",
    "/archive.html",
    "/about.html",
    "/journal.js",
    "/reader.js",
    "/portfolio.html",
    "/work.html",
    "/admin.html",
    "/studio.html",
    "/common.js",
  ])
    assert.equal((await call(page)).status, 200, page);
  assert.deepEqual(await (await call("/api/posts")).json(), []);
  assert.equal((await call("/api/does-not-exist")).status, 404);
  assert.equal(
    (
      await call(
        "/api/auth/login",
        json({ username: "admin", password: "wrong" }),
      )
    ).status,
    401,
  );
  const token = await login();
  const input = {
    title: "持久化测试",
    category: "环境场景",
    date: "2026-10-19",
    description: "中文描述\n第二行",
    cover: "/assets/works/blue-hour.png",
    images: [],
    software: "Blender",
    featured: true,
  };
  // Auth must precede content-type checks and body parsing.
  for (const route of [
    "/api/posts",
    "/api/works",
    "/api/uploads",
    "/api/model-uploads?format=glb",
  ])
    assert.equal(
      (await call(route, { method: "POST", body: "invalid body" })).status,
      401,
      route,
    );
  assert.equal(
    (
      await call(
        "/api/works",
        json({ ...input, cover: "javascript:alert(1)" }, token),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/works",
        json(
          {
            ...input,
            images: Array.from({ length: 30 }, (_, i) => `/assets/${i}.png`),
          },
          token,
        ),
      )
    ).status,
    400,
  );
  let response = await call("/api/works", json(input, token));
  assert.equal(response.status, 201);
  const work = await response.json();
  assert.equal((await call("/api/model-jobs/unknown")).status, 401);
  assert.equal(
    (await call("/api/model-jobs/unknown", { headers: auth(token) })).status,
    404,
  );
  assert.equal(
    (await call("/api/models/config", { headers: auth(token) })).status,
    200,
  );
  for (const invalid of [Buffer.from("not glb"), triangleGlb(true)]) {
    assert.equal(
      (
        await call("/api/model-uploads?format=glb", {
          method: "POST",
          headers: auth(token),
          body: invalid,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await call(
        "/api/works",
        json({ ...input, model: "https://example.com/a.glb" }, token),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/works",
        json(
          {
            ...input,
            model: "/uploads/models/00000000-0000-0000-0000-000000000000.glb",
          },
          token,
        ),
      )
    ).status,
    400,
  );
  const modelBytes = triangleGlb();
  response = await call("/api/model-uploads?format=glb", {
    method: "POST",
    headers: auth(token),
    body: modelBytes,
  });
  assert.equal(response.status, 202);
  let modelJob = await response.json();
  for (
    let attempt = 0;
    modelJob.status === "processing" && attempt < 100;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    modelJob = await (
      await call("/api/model-jobs/" + modelJob.id, { headers: auth(token) })
    ).json();
  }
  assert.equal(modelJob.status, "ready", modelJob.message);
  assert.match(modelJob.url, /^\/uploads\/models\/[a-f0-9-]+\.glb$/);
  assert.deepEqual(
    Buffer.from(await (await call(modelJob.url)).arrayBuffer()),
    modelBytes,
  );
  assert.equal(
    (await call("/model-jobs/" + modelJob.id + "/source.glb")).status,
    404,
  );
  input.model = modelJob.url;
  assert.equal(
    (
      await call(
        "/api/works/" + work.id,
        json({ ...input, title: "更新后的作品" }, token, "PUT"),
      )
    ).status,
    200,
  );
  const png = await readFile("public/assets/works/blue-hour.png");
  assert.equal(
    (
      await call("/api/uploads", {
        method: "POST",
        headers: auth(token),
        body: "<svg></svg>",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/uploads", {
        method: "POST",
        headers: auth(token),
        body: Buffer.alloc(20 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  response = await call("/api/uploads", {
    method: "POST",
    headers: auth(token),
    body: png,
  });
  assert.equal(response.status, 201);
  const upload = await response.json();
  assert.match(upload.url, /^\/uploads\/[a-f0-9-]+\.png$/);
  response = await call(upload.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  // Use an actual encoded video, not just a fabricated extension or header.
  const mp4 = await readFile("public/media/blog-background.mp4");
  response = await call("/api/uploads", {
    method: "POST",
    headers: auth(token),
    body: mp4,
  });
  assert.equal(response.status, 201);
  const video = await response.json();
  assert.match(video.url, /^\/uploads\/[a-f0-9-]+\.mp4$/);
  response = await call(video.url, { method: "HEAD" });
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(Number(response.headers.get("content-length")), mp4.length);
  response = await call(video.url, { headers: { Range: "bytes=0-1023" } });
  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("content-range"),
    `bytes 0-1023/${mp4.length}`,
  );
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    mp4.subarray(0, 1024),
  );
  assert.equal(
    (await call(video.url, { headers: { Range: `bytes=${mp4.length}-` } }))
      .status,
    416,
  );
  assert.equal(
    (
      await call("/api/uploads", {
        method: "POST",
        headers: auth(token),
        body: mp4.subarray(0, 64),
      })
    ).status,
    400,
  );
  // A valid container larger than the image limit must still upload as video.
  const free = Buffer.alloc(21 * 1024 * 1024);
  free.writeUInt32BE(free.length);
  free.write("free", 4);
  response = await call("/api/uploads", {
    method: "POST",
    headers: auth(token),
    body: Buffer.concat([mp4, free]),
  });
  assert.equal(response.status, 201);
  assert.equal(
    (
      await call("/api/uploads", {
        method: "POST",
        headers: auth(token),
        body: Buffer.alloc(100 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  response = await call(
    "/api/works/" + work.id,
    json(
      {
        ...input,
        title: "更新后的作品",
        cover: video.url,
        images: [upload.url],
      },
      token,
      "PUT",
    ),
  );
  assert.equal(response.status, 200);
  const post = {
    title: "兼容测试",
    excerpt: "摘要",
    category: "STUDY",
    date: "2026.10.19",
    image: "assets/cover-featured.svg",
    content: ["正文", `[video](${video.url})`],
  };
  assert.equal(
    (await call("/api/posts", json({ ...post, content: ["  "] }, token)))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/posts",
        json({ ...post, image: "javascript:alert(1)" }, token),
      )
    ).status,
    400,
  );
  response = await call("/api/posts", json(post, token));
  assert.equal(response.status, 201);
  const savedPost = await response.json();
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      call("/api/posts", json({ ...post, title: `并发 ${i}` }, token)),
    ),
  );
  assert.ok(concurrent.every((response) => response.status === 201));
  assert.equal((await (await call("/api/posts")).json()).length, 9);
  // A failed disk write must leave both memory and the saved collection unchanged.
  await mkdir(path.join(dataDir, "posts.json.tmp"));
  response = await call(
    "/api/posts",
    json({ ...post, title: "不应保存" }, token),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "保存失败，请检查服务器日志",
  });
  assert.equal((await (await call("/api/posts")).json()).length, 9);
  await rm(path.join(dataDir, "posts.json.tmp"), { recursive: true });
  await stop();
  await start();
  assert.equal(
    (await (await call("/api/works/" + work.id)).json()).title,
    "更新后的作品",
  );
  assert.equal((await call(upload.url)).status, 200);
  assert.equal((await call(video.url)).status, 200);
  assert.equal(
    (await (await call("/api/works/" + work.id)).json()).model,
    modelJob.url,
  );
  assert.equal((await call(modelJob.url)).status, 200);
  assert.equal(
    (await (await call("/api/works/" + work.id)).json()).cover,
    video.url,
  );
  assert.deepEqual(
    (await (await call("/api/posts/" + savedPost.id)).json()).content,
    post.content,
  );
  assert.equal((await (await call("/api/posts")).json()).length, 9);
  assert.equal(
    (await call("/api/auth/session", { headers: auth(token) })).status,
    401,
  );
  const fresh = await login();
  assert.equal(
    (
      await call(
        "/api/posts/" + savedPost.id,
        json({ ...post, title: "更新文章" }, fresh, "PUT"),
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await call("/api/posts/" + savedPost.id)).json()).title,
    "更新文章",
  );
  assert.equal(
    (
      await call("/api/posts/" + savedPost.id, {
        method: "DELETE",
        headers: auth(fresh),
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/posts/" + savedPost.id)).status, 404);
  assert.equal(
    (
      await call("/api/works/" + work.id, {
        method: "DELETE",
        headers: auth(fresh),
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/works/" + work.id)).status, 404);
  assert.equal(
    (await call("/api/auth/logout", { method: "POST", headers: auth(fresh) }))
      .status,
    204,
  );
  assert.equal(
    (await call("/api/auth/session", { headers: auth(fresh) })).status,
    401,
  );
  for (let i = 0; i < 9; i++)
    assert.equal(
      (
        await call(
          "/api/auth/login",
          json({ username: "admin", password: "wrong" }),
        )
      ).status,
      401,
    );
  response = await call(
    "/api/auth/login",
    json({ username: "admin", password }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  await stop();
  await writeFile(path.join(dataDir, "works.json"), "broken JSON");
  await assert.rejects(start, /Server exited/);
  assert.equal(
    await readFile(path.join(dataDir, "works.json"), "utf8"),
    "broken JSON",
  );
  console.log(
    "PASS: auth before parsing, validation, CRUD, upload limits, concurrent writes, failed-write rollback, restart persistence, rate limits, corrupt-data preservation",
  );
} finally {
  await stop();
  await rm(dataDir, { recursive: true, force: true });
}
