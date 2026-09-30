// Applies the saved light/dark preference before the page renders (avoids a flash).
(function () {
  try {
    var pref = localStorage.getItem("nest.theme") || "auto";
    var dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
