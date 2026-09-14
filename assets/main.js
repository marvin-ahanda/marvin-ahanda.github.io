/* =============================================================================
   MAIN — comportements de page
   Volontairement minimal : aucune animation ne doit retarder la lecture.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------------
     1. NAV : fond opaque dès qu'on quitte le haut de page
     ------------------------------------------------------------------------ */
  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------------------------------------------------------------------------
     2. RÉVÉLATIONS AU SCROLL — fondus uniquement
     Désactivées par CSS si prefers-reduced-motion (voir style.css §17).
     ------------------------------------------------------------------------ */
  var revealables = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    // Pas d'IO : on affiche tout, sans condition.
    Array.prototype.forEach.call(revealables, function (el) {
      el.classList.add("is-in");
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );

    Array.prototype.forEach.call(revealables, function (el) {
      observer.observe(el);
    });
  }

  /* ---------------------------------------------------------------------------
     3. COMPTEURS — les chiffres montent de 0 à leur valeur
     Déclenché une seule fois, à l'entrée du bloc dans l'écran.
     Le HTML contient déjà la valeur finale : sans JS, rien ne manque.
     ------------------------------------------------------------------------ */
  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  var counters = Array.prototype.slice.call(
    document.querySelectorAll("[data-count]")
  );

  function runCounter(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (isNaN(target)) return;

    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1200; // assez rapide pour ne jamais faire attendre
    var startedAt = null;

    // easeOutExpo : démarrage franc, arrivée nette sur le chiffre final.
    function ease(t) {
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function frame(now) {
      if (startedAt === null) startedAt = now;
      var t = Math.min(1, (now - startedAt) / duration);
      el.textContent = Math.round(ease(t) * target) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }

    el.textContent = "0" + suffix;
    requestAnimationFrame(frame);
  }

  if (counters.length && !reduceMotion && "IntersectionObserver" in window) {
    var countObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          countObserver.unobserve(entry.target);
          runCounter(entry.target);
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach(function (el) {
      countObserver.observe(el);
    });
  }

  /* ---------------------------------------------------------------------------
     4. DÉMO ANIMÉE — lecture/pause + mise en veille hors écran
     La scène est 100 % CSS : ici on ne fait que piloter animation-play-state.
     ------------------------------------------------------------------------ */
  var demo = document.getElementById("demo-figure");

  if (demo) {
    // Les paquets de données suivent un offset-path : on ne les anime que si
    // le navigateur sait le faire, sinon ils resteraient bloqués dans un coin.
    if (
      window.CSS &&
      CSS.supports &&
      CSS.supports("offset-path", 'path("M0 0L1 1")')
    ) {
      document.documentElement.classList.add("has-motion-path");
    }

    var playBtn = document.getElementById("demo-play");

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        var paused = demo.classList.toggle("is-paused");
        playBtn.setAttribute("aria-pressed", paused ? "false" : "true");
        playBtn.setAttribute(
          "aria-label",
          paused ? "Lancer l'animation" : "Mettre l'animation en pause"
        );
      });
    }

    if ("IntersectionObserver" in window) {
      var demoObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            demo.classList.toggle("is-idle", !entry.isIntersecting);
          });
        },
        { threshold: 0 }
      );
      demoObserver.observe(demo);
    }
  }

  /* ---------------------------------------------------------------------------
     5. ANNÉE COURANTE DANS LE FOOTER
     ------------------------------------------------------------------------ */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
