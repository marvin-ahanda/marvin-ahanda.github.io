/* =============================================================================
   HERO — EFFET "DROP & SETTLE"
   -----------------------------------------------------------------------------
   Les badges d'outils tombent depuis le haut du viewport, rebondissent,
   s'entrechoquent et se stabilisent en tas au bas du hero.

   Rendu HYBRIDE, volontairement :
     - Matter.js calcule uniquement la physique (positions + angles).
     - Les badges restent des éléments DOM réels, positionnés par transform.
       Aucun logo n'est dessiné dans un canvas : le texte reste net,
       sélectionnable et lisible par les lecteurs d'écran.

   Progressive enhancement : le HTML part déjà en grille statique lisible
   (classe .is-static). Ce script ne prend la main que si tout est réuni.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------------
     1. PARAMÈTRES
     Réglés pour l'élégance, pas pour le réalisme physique.
     ------------------------------------------------------------------------ */
  var CONFIG = {
    gravityY: 0.7, // chute posée : ni molle, ni brutale
    friction: 0.35, // les badges glissent peu les uns sur les autres
    frictionAir: 0.02, // freine la chute, évite l'effet "pierre"
    restitution: 0.25, // petit rebond, pas de trampoline
    density: 0.002,
    chamferRadius: 8, // coins arrondis = collisions naturelles
    // Matter applique frictionStatic = max(A, B) et 0,5 par défaut : un badge
    // posé sur une pente ne repartirait jamais. On l'abaisse pour que le toit
    // du CTA joue réellement son rôle de déflecteur.
    frictionStatic: 0.15,
    maxAngle: 0.35, // angle initial aléatoire : -0.35 à +0.35 rad
    spawnSpread: 0.7, // les badges apparaissent sur 70 % de la largeur, centrés
    staggerMs: 120, // décalage entre deux injections
    startDelayMs: 400, // on laisse lire le H1 avant de lancer la scène
    settleGuardMs: 6000, // filet de sécurité : endort la scène quoi qu'il arrive
    groundOffset: 26, // le sol remonte un peu : la pile reste entièrement visible
    // Le CTA est un obstacle PENDANT la chute (c'est là que l'effet se lit :
    // les badges le percutent et rebondissent dessus), puis il est retiré du
    // monde juste avant la stabilisation. Tout ce qui était perché redescend
    // rejoindre la pile : le texte du hero reste lisible à l'état final.
    ctaReleaseMs: 1300,
    wallThickness: 60,
    ceilingY: -2000, // plafond très haut : borne le monde sans jamais bloquer
    mobileBreakpoint: 768,
    desktopCount: 12,
    mobileCount: 7
  };

  /* ---------------------------------------------------------------------------
     2. RÉFÉRENCES DOM + ÉTAT
     ------------------------------------------------------------------------ */
  var hero = document.getElementById("hero");
  var layer = document.getElementById("physics-layer");
  var grid = document.getElementById("physics-grid");
  if (!hero || !layer || !grid) return;

  var allBadges = Array.prototype.slice.call(
    grid.querySelectorAll("[data-badge]")
  );
  if (!allBadges.length) return;

  // La rangée CTA entière sert d'obstacle (et non chaque bouton séparément) :
  // deux obstacles voisins créent un interstice où les badges se coincent.
  var obstacleEls = [document.querySelector(".hero__actions")].filter(Boolean);

  var state = {
    engine: null,
    runnerId: null, // id de requestAnimationFrame
    running: false,
    items: [], // { el, body, w, h }
    statics: [], // colliders statiques (sol, murs, plafond, CTA)
    mouseConstraint: null,
    timers: [], // callbacks GSAP / setTimeout en attente
    compact: false,
    destroyed: false
  };

  var prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ---------------------------------------------------------------------------
     3. RESPONSIVE : combien de badges, et à quelle taille
     ------------------------------------------------------------------------ */
  function isMobile() {
    return window.innerWidth < CONFIG.mobileBreakpoint;
  }

  function activeBadges() {
    var count = isMobile() ? CONFIG.mobileCount : CONFIG.desktopCount;
    return allBadges.slice(0, count);
  }

  /** Masque les badges en trop et passe en typo compacte sous 768px. */
  function applyResponsiveVisibility() {
    var count = isMobile() ? CONFIG.mobileCount : CONFIG.desktopCount;
    state.compact = isMobile();
    layer.classList.toggle("is-compact", state.compact);

    allBadges.forEach(function (el, i) {
      var visible = i < count;
      el.hidden = !visible;
      // Les badges masqués sortent aussi de l'ordre de lecture.
      el.setAttribute("aria-hidden", visible ? "false" : "true");
    });
  }

  /* ---------------------------------------------------------------------------
     4. MODE STATIQUE (reduced-motion, absence de Matter.js, ou pas de JS)
     Le hero doit rester impeccable dans tous ces cas.
     ------------------------------------------------------------------------ */
  function renderStatic() {
    layer.classList.add("is-static");
    layer.classList.remove("is-interactive");
    applyResponsiveVisibility();

    // Fondu simple, échelonné très légèrement — aucune physique.
    activeBadges().forEach(function (el, i) {
      el.style.animationDelay = prefersReducedMotion ? "0ms" : i * 45 + "ms";
    });
  }

  /* ---------------------------------------------------------------------------
     5. CONSTRUCTION DE LA SCÈNE
     ------------------------------------------------------------------------ */
  function heroSize() {
    return { w: hero.clientWidth, h: hero.clientHeight };
  }

  /** Mesure chaque badge PENDANT qu'il est encore en flux statique. */
  function measureBadges() {
    var measured = [];
    activeBadges().forEach(function (el) {
      var r = el.getBoundingClientRect();
      measured.push({ el: el, w: Math.round(r.width), h: Math.round(r.height) });
    });
    return measured;
  }

  /**
   * Collider de la rangée CTA : une pilule alignée sur les boutons.
   *
   * Les badges la percutent et rebondissent dessus pendant la chute — c'est ce
   * détail qui donne au CTA sa présence physique dans la scène. Le corps est
   * ensuite retiré du monde (voir releaseCta) pour qu'aucun badge ne termine
   * perché dessus, au détriment de la lisibilité du texte.
   */
  function obstacleFromElement(el) {
    var heroRect = hero.getBoundingClientRect();
    var r = el.getBoundingClientRect();

    return [
      Matter.Bodies.rectangle(
        r.left - heroRect.left + r.width / 2,
        r.top - heroRect.top + r.height / 2,
        r.width,
        r.height,
        {
          isStatic: true,
          chamfer: { radius: Math.max(0, Math.min(26, r.height / 2 - 1)) },
          friction: 0.02,
          restitution: 0.25,
          label: "obstacle:row"
        }
      )
    ];
  }

  /** Retire le CTA de la scène et réveille les badges qui reposaient dessus. */
  function releaseCta() {
    if (!state.engine) return;

    state.statics = state.statics.filter(function (body) {
      if (body.label !== "obstacle:row") return true;
      Matter.Composite.remove(state.engine.world, body);
      return false;
    });

    state.items.forEach(function (item) {
      Matter.Sleeping.set(item.body, false);
    });
    start();
  }

  /**
   * Colliders statiques invisibles :
   *   1. un sol aligné sur le bas du hero
   *   2. deux murs latéraux (empêchent la fuite des corps)
   *   3. les boutons CTA, pour que les badges s'empilent AUTOUR et jamais dessus
   *   4. un plafond très haut, non bloquant, juste pour borner le monde
   */
  function buildStatics() {
    var s = heroSize();
    var t = CONFIG.wallThickness;

    var ground = Matter.Bodies.rectangle(
      s.w / 2,
      s.h - CONFIG.groundOffset + t / 2,
      s.w * 2,
      t,
      { isStatic: true, friction: 0.6, label: "ground" }
    );
    var leftWall = Matter.Bodies.rectangle(
      -t / 2,
      s.h / 2,
      t,
      s.h * 3,
      { isStatic: true, label: "wall-left" }
    );
    var rightWall = Matter.Bodies.rectangle(
      s.w + t / 2,
      s.h / 2,
      t,
      s.h * 3,
      { isStatic: true, label: "wall-right" }
    );
    var ceiling = Matter.Bodies.rectangle(
      s.w / 2,
      CONFIG.ceilingY,
      s.w * 2,
      t,
      { isStatic: true, label: "ceiling" }
    );

    var statics = [ground, leftWall, rightWall, ceiling];
    obstacleEls.forEach(function (el) {
      statics = statics.concat(obstacleFromElement(el));
    });

    return statics;
  }

  /** Crée le corps physique d'un badge et l'injecte dans le monde. */
  function spawnBadge(item, index) {
    if (state.destroyed || !state.engine) return;

    var s = heroSize();
    var margin = (1 - CONFIG.spawnSpread) / 2; // 15 % de chaque côté
    var x = s.w * margin + Math.random() * s.w * CONFIG.spawnSpread;
    var y = -(100 + Math.random() * 160 + index * 20); // au-dessus du viewport

    // Garde le badge dans les murs même s'il est large
    x = Math.max(item.w / 2 + 8, Math.min(s.w - item.w / 2 - 8, x));

    var body = Matter.Bodies.rectangle(x, y, item.w, item.h, {
      friction: CONFIG.friction,
      frictionStatic: CONFIG.frictionStatic,
      frictionAir: CONFIG.frictionAir,
      restitution: CONFIG.restitution,
      density: CONFIG.density,
      chamfer: { radius: CONFIG.chamferRadius },
      label: "badge"
    });

    Matter.Body.setAngle(
      body,
      (Math.random() * 2 - 1) * CONFIG.maxAngle
    );

    item.body = body;
    state.items.push(item);
    Matter.Composite.add(state.engine.world, body);

    // Le badge n'est révélé qu'au moment où il entre réellement dans la scène.
    item.el.style.opacity = "1";

    start(); // relance la boucle si elle s'était endormie
  }

  /* ---------------------------------------------------------------------------
     6. BOUCLE DE RENDU
     requestAnimationFrame -> Engine.update -> transform sur chaque élément DOM
     ------------------------------------------------------------------------ */
  function tick() {
    if (!state.running || !state.engine) return;

    Matter.Engine.update(state.engine, 1000 / 60);

    var allAsleep = state.items.length > 0;

    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i];
      var b = item.body;

      // translate3d force la composition GPU ; rotate applique l'angle physique.
      item.el.style.transform =
        "translate3d(" +
        (b.position.x - item.w / 2).toFixed(2) +
        "px," +
        (b.position.y - item.h / 2).toFixed(2) +
        "px,0) rotate(" +
        b.angle.toFixed(4) +
        "rad)";

      if (!b.isSleeping) allAsleep = false;
    }

    // Scène stabilisée : on coupe la boucle. Zéro CPU tant que rien ne bouge.
    if (allAsleep && state.items.length === activeBadges().length) {
      stop();
      return;
    }

    state.runnerId = requestAnimationFrame(tick);
  }

  function start() {
    if (state.running || state.destroyed) return;
    state.running = true;
    state.runnerId = requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    if (state.runnerId) cancelAnimationFrame(state.runnerId);
    state.runnerId = null;
  }

  /* ---------------------------------------------------------------------------
     7. INTERACTION — attraper un badge et le lancer (desktop uniquement)
     Sur mobile, MouseConstraint capterait le touchmove et bloquerait le scroll
     de la page : l'interaction y est volontairement désactivée.
     ------------------------------------------------------------------------ */
  function enableDragging() {
    var finePointer =
      window.matchMedia("(pointer: fine)").matches && !isMobile();
    if (!finePointer) return;

    var mouse = Matter.Mouse.create(hero);

    // On retire les écouteurs tactiles de Matter : ils cassent le scroll.
    if (mouse.mousewheel) {
      mouse.element.removeEventListener("wheel", mouse.mousewheel);
      mouse.element.removeEventListener("mousewheel", mouse.mousewheel);
    }
    mouse.element.removeEventListener("touchstart", mouse.mousedown);
    mouse.element.removeEventListener("touchmove", mouse.mousemove);
    mouse.element.removeEventListener("touchend", mouse.mouseup);

    state.mouseConstraint = Matter.MouseConstraint.create(state.engine, {
      mouse: mouse,
      constraint: { stiffness: 0.15, damping: 0.25, render: { visible: false } }
    });

    Matter.Composite.add(state.engine.world, state.mouseConstraint);
    layer.classList.add("is-interactive");

    // Une saisie réveille la scène si elle s'était endormie.
    hero.addEventListener("pointerdown", start);
  }

  /* ---------------------------------------------------------------------------
     8. CYCLE DE VIE
     ------------------------------------------------------------------------ */
  function schedule(delayMs, fn) {
    if (window.gsap) {
      state.timers.push(window.gsap.delayedCall(delayMs / 1000, fn));
    } else {
      state.timers.push(setTimeout(fn, delayMs));
    }
  }

  function clearTimers() {
    state.timers.forEach(function (t) {
      if (t && typeof t.kill === "function") t.kill();
      else clearTimeout(t);
    });
    state.timers = [];
  }

  function build() {
    applyResponsiveVisibility();

    // 1. Mesurer PENDANT que la grille statique est encore en place.
    var measured = measureBadges();

    // 2. Basculer en mode physique : les badges deviennent absolus.
    layer.classList.remove("is-static");
    measured.forEach(function (item) {
      item.el.style.opacity = "0"; // révélé à l'injection
      item.el.style.animation = "none";
      item.el.style.transform = "translate3d(-9999px,-9999px,0)";
    });

    // 3. Moteur. enableSleeping permet d'endormir les corps stabilisés.
    state.engine = Matter.Engine.create({ enableSleeping: true });
    state.engine.world.gravity.y = CONFIG.gravityY;

    // 4. Colliders statiques
    state.statics = buildStatics();
    Matter.Composite.add(state.engine.world, state.statics);

    // 5. Drag desktop
    enableDragging();

    // 6. ORCHESTRATION GSAP : ordre aléatoire, 120 ms entre chaque badge,
    //    démarrage 400 ms après l'apparition du titre.
    var order = measured.slice();
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    order.forEach(function (item, i) {
      schedule(CONFIG.startDelayMs + i * CONFIG.staggerMs, function () {
        spawnBadge(item, i);
      });
    });

    var lastSpawnMs = CONFIG.startDelayMs + order.length * CONFIG.staggerMs;

    // 7. Libération du CTA : les badges encore perchés dessus redescendent.
    schedule(lastSpawnMs + CONFIG.ctaReleaseMs, releaseCta);

    // Filet de sécurité : si un corps refuse de s'endormir, on coupe la boucle.
    schedule(
      lastSpawnMs + CONFIG.settleGuardMs,
      function () {
        state.items.forEach(function (item) {
          Matter.Sleeping.set(item.body, true);
        });
      }
    );

    start();
  }

  function teardown() {
    stop();
    clearTimers();

    if (state.mouseConstraint && state.engine) {
      Matter.Composite.remove(state.engine.world, state.mouseConstraint);
      state.mouseConstraint = null;
    }
    if (state.engine) {
      Matter.World.clear(state.engine.world, false);
      Matter.Engine.clear(state.engine);
      state.engine = null;
    }

    hero.removeEventListener("pointerdown", start);
    state.items = [];
    state.statics = [];

    allBadges.forEach(function (el) {
      el.style.transform = "";
      el.style.opacity = "";
      el.style.animation = "";
    });
  }

  /* ---------------------------------------------------------------------------
     9. RESIZE
     On repositionne les colliders statiques sans relancer la simulation.
     On ne reconstruit entièrement que si on change de palier (mobile/desktop).
     ------------------------------------------------------------------------ */
  function repositionStatics() {
    if (!state.engine) return;
    var s = heroSize();
    var t = CONFIG.wallThickness;

    state.statics.forEach(function (body) {
      if (body.label === "ground") {
        Matter.Body.setPosition(body, {
          x: s.w / 2,
          y: s.h - CONFIG.groundOffset + t / 2
        });
      } else if (body.label === "wall-left") {
        Matter.Body.setPosition(body, { x: -t / 2, y: s.h / 2 });
      } else if (body.label === "wall-right") {
        Matter.Body.setPosition(body, { x: s.w + t / 2, y: s.h / 2 });
      } else if (body.label === "ceiling") {
        Matter.Body.setPosition(body, { x: s.w / 2, y: CONFIG.ceilingY });
      } else if (body.label === "obstacle:row") {
        var el = obstacleEls[0];
        if (!el) return;
        var heroRect = hero.getBoundingClientRect();
        var r = el.getBoundingClientRect();
        Matter.Body.setPosition(body, {
          x: r.left - heroRect.left + r.width / 2,
          y: r.top - heroRect.top + r.height / 2
        });
      }
    });

    // Les corps endormis doivent être réveillés pour retomber correctement.
    state.items.forEach(function (item) {
      Matter.Sleeping.set(item.body, false);
    });
    start();
  }

  var resizeTimer = null;
  var wasMobile = isMobile();

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var nowMobile = isMobile();
      if (nowMobile !== wasMobile) {
        // Changement de palier : on reconstruit proprement.
        wasMobile = nowMobile;
        teardown();
        if (canAnimate()) build();
        else renderStatic();
      } else {
        repositionStatics();
      }
    }, 220);
  }

  /* ---------------------------------------------------------------------------
     10. PAUSE HORS ÉCRAN — ne jamais faire tourner la physique dans le vide
     ------------------------------------------------------------------------ */
  function observeVisibility() {
    if (!("IntersectionObserver" in window)) return;

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) start();
          else stop();
        });
      },
      { threshold: 0 }
    );
    io.observe(hero);

    // Onglet en arrière-plan : même logique.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });
  }

  /* ---------------------------------------------------------------------------
     11. DÉMARRAGE
     ------------------------------------------------------------------------ */
  function canAnimate() {
    return !prefersReducedMotion && typeof window.Matter !== "undefined";
  }

  function init() {
    if (!canAnimate()) {
      renderStatic(); // reduced-motion OU Matter.js indisponible
      return;
    }
    build();
    observeVisibility();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
  }

  // Les polices modifient la largeur des badges : on mesure après leur chargement.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init).catch(init);
  } else {
    window.addEventListener("load", init);
  }

  // Nettoyage explicite (utile si la page est intégrée dans une SPA).
  window.addEventListener("pagehide", teardown);
  window.heroPhysicsDestroy = teardown;
})();
