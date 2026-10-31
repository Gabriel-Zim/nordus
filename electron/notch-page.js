(() => {
  const ARM_MS = 700;
  const LOCK_MS = 4000;
  const bridge = window.notchWindow;
  const byId = (id) => document.getElementById(id);
  const shape = byId("shape");
  const buttons = { approve: byId("approve"), decline: byId("decline"), open: byId("open") };
  let approvalId = null;
  let armUntil = 0;
  let lockUntil = 0;
  let settleTimer = null;

  const settle = () => {
    clearTimeout(settleTimer);
    const now = Date.now();
    const armed = approvalId === null || armUntil > now;
    const held = armed || lockUntil > now;
    buttons.approve.disabled = held;
    buttons.decline.disabled = held;
    buttons.open.disabled = armed;
    const until = Math.max(armUntil, lockUntil);
    if (until > now) settleTimer = setTimeout(settle, until - now);
  };

  const decide = (decision) => {
    if (approvalId === null || Date.now() < Math.max(armUntil, lockUntil)) return;
    bridge.decide(approvalId, decision);
    lockUntil = Date.now() + LOCK_MS;
    settle();
  };

  buttons.approve.addEventListener("click", () => decide("approve"));
  buttons.decline.addEventListener("click", () => decide("decline"));
  buttons.open.addEventListener("click", () => bridge.open());
  byId("left").addEventListener("click", () => bridge.open());
  byId("right").addEventListener("click", () => bridge.open());

  const paint = (view) => {
    const { layout } = view;
    shape.dataset.phase = view.phase;
    shape.dataset.kind = layout.kind;
    shape.classList.toggle("expanded", view.expanded);
    shape.style.setProperty("--left", `${layout.left}px`);
    shape.style.setProperty("--gap", `${layout.gap}px`);
    shape.style.setProperty("--right", `${layout.right}px`);
    shape.style.setProperty("--strip", `${layout.strip}px`);
    shape.style.setProperty("--panel", `${layout.panel}px`);

    byId("avatars").replaceChildren(...view.avatars.map((avatar) => {
      const element = document.createElement("span");
      element.className = "avatar";
      element.textContent = avatar.initial;
      element.style.setProperty("--c", avatar.color);
      return element;
    }));
    byId("text").textContent = view.text;

    const approval = view.approval;
    const changed = (approval ? approval.id : null) !== approvalId;
    approvalId = approval ? approval.id : null;
    if (approval) {
      byId("header").textContent = approval.header;
      byId("sentence").textContent = approval.text;
      buttons.approve.textContent = view.buttons.approve;
      buttons.decline.textContent = view.buttons.decline;
      buttons.open.textContent = view.buttons.open;
      buttons.approve.hidden = !approval.decidable;
      buttons.decline.hidden = !approval.decidable;
      buttons.open.hidden = approval.decidable;
    }
    if (changed || view.appearing === true) {
      lockUntil = 0;
      armUntil = approvalId === null ? 0 : Date.now() + ARM_MS;
      settle();
    }
  };

  bridge.onView(paint);
})();
