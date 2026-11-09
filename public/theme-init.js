// Sets the theme before the first paint so a dark-mode user never sees a white
// flash; ThemeService owns it from there. A file rather than an inline script,
// so the Content-Security-Policy can forbid inline scripts (nginx.conf).
(function () {
  try {
    var saved = localStorage.getItem('orthoflow_theme');
    var dark = saved === 'dark' || ((!saved || saved === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    }
  } catch (e) { /* storage blocked: stay light */ }
})();
