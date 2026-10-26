(() => {
  const video = document.querySelector(".season-background video");
  const control = document.querySelector("#background-control");
  if (!video || !control) return;
  let pausedByUser = false;
  video.muted = true;
  function update() {
    control.textContent = video.paused ? "播放背景" : "暂停背景";
    control.setAttribute(
      "aria-label",
      video.paused ? "播放背景视频" : "暂停背景视频",
    );
    control.hidden = false;
  }
  function resume() {
    if (pausedByUser || document.hidden) {
      video.pause();
      return;
    }
    video.play().catch(() => update());
  }
  video.addEventListener("loadeddata", () => {
    if (pausedByUser) video.pause();
    else resume();
    update();
  });
  video.addEventListener("play", update);
  video.addEventListener("pause", update);
  video.addEventListener("error", () => {
    control.hidden = true;
  });
  control.addEventListener("click", () => {
    pausedByUser = !video.paused;
    if (pausedByUser) video.pause();
    else video.play().catch(() => update());
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
    else resume();
  });
  if (video.readyState >= 2) {
    resume();
    update();
  }
})();
