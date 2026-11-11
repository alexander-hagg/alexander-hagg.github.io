(function () {
  "use strict";

  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");

  if (toggle && nav) {
    const setOpen = function (open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
      document.body.classList.toggle("nav-open", open);
    };

    toggle.addEventListener("click", function () {
      setOpen(!nav.classList.contains("is-open"));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    const desktop = window.matchMedia("(min-width: 941px)");
    const onChange = function () {
      if (desktop.matches) setOpen(false);
    };
    if (desktop.addEventListener) desktop.addEventListener("change", onChange);
    else if (desktop.addListener) desktop.addListener(onChange);
  }

  const section = document.body.getAttribute("data-section");
  if (section) {
    const link = document.querySelector('.main-nav a[data-nav="' + section + '"]');
    if (link) link.setAttribute("aria-current", "page");
  }

  const progress = document.querySelector(".read-progress span");
  if (progress) {
    let queued = false;
    const update = function () {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progress.style.transform = "scaleX(" + ratio + ")";
      queued = false;
    };
    window.addEventListener("scroll", function () {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  document.querySelectorAll('.prose a[href^="http"]').forEach(function (a) {
    try {
      const url = new URL(a.href);
      if (url.hostname !== window.location.hostname) {
        a.target = "_blank";
        a.rel = "noopener";
      }
    } catch (err) {
      /* Leave malformed links untouched. */
    }
  });
})();
