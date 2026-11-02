/* Sets the theme before first paint. The game route is always night. */
(function () {
  try {
    var p = localStorage.getItem("cubes:theme");
    var dark = p === "dark" || (p !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (location.pathname.indexOf("/game/") === 0) dark = true;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", dark ? "#0f0e0c" : "#f2eee5");
  } catch (e) {}
})();
