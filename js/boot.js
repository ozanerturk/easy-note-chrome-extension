// Runs render-blocking from <head>, before first paint.
//
// The sidebar's real state lives in IndexedDB, but that read resolves after
// the page has already painted — so the sidebar would render open and then
// animate shut on every new tab. localStorage is synchronous, so it is
// mirrored there purely to get the class on <html> before anything is drawn.
// MV3's CSP forbids inline scripts, hence a file rather than a <script> block.
try {
  if (localStorage.getItem("easynote:sidebar") === "hidden") {
    document.documentElement.classList.add("sidebar-hidden");
  }
  // Same reasoning for the width: applying it after paint would show the
  // sidebar snapping from its default to the user's size on every new tab.
  // Privacy blur, above all else: if this waited for the database read the
  // notes would render readable for a frame or two — on a shared screen that
  // is the whole thing this feature exists to prevent.
  if (localStorage.getItem("easynote:blurNotes") === "on") {
    document.documentElement.classList.add("blur-notes");
  }

  // Same again for the theme: waiting on the database read would flash a
  // light page before going dark on every single new tab.
  const theme = localStorage.getItem("easynote:theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }

  const width = parseInt(localStorage.getItem("easynote:sidebarWidth"), 10);
  if (Number.isFinite(width) && width >= 150 && width <= 460) {
    document.documentElement.style.setProperty("--sidebar-w", `${width}px`);
  }
} catch (e) {
  /* private mode or storage disabled: fall back to the async read */
}
