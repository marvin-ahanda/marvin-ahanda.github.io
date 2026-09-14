/* =============================================================================
   SOUND TOGGLE — onde sinusoïdale + nappe ambient
   -----------------------------------------------------------------------------
   OFF (état par défaut) : polyline de 30 points tous à y = 0 → ligne droite.
   ON  : boucle requestAnimationFrame qui recalcule le déphasage à partir du
         temps réel (performance.now()), donc une onde qui SE DÉPLACE —
         et non une animation CSS figée en boucle.

   Aucune dépendance externe : rAF natif + Web Audio API.
   ========================================================================== */

(function (global) {
  "use strict";

  /* ---------------------------------------------------------------------------
     PARAMÈTRES
     ------------------------------------------------------------------------ */
  var POINTS = 30; // nombre de points de la polyline
  var VIEW_W = 20; // largeur du viewBox
  var AMPLITUDE = 4; // amplitude de l'onde (unités viewBox)
  var SPEED = 0.0025; // vitesse de déphasage (rad par ms)
  var STATIC_AMPLITUDE = 1.6; // onde figée en reduced-motion
  var STORAGE_KEY = "nexia:sound"; // mémorise le choix du visiteur

  var AUDIO = {
    // Piste : boucle ambient de 40 mesures à 70 BPM, raccordée au sample près
    // (fondu à puissance constante de 2 mesures), normalisée à -16 LUFS.
    // Si le fichier est absent ou illisible, on retombe automatiquement sur la
    // nappe synthétisée : le bouton ne casse jamais.
    useFile: true,
    file: "audio/ambient.mp3",
    fileVolume: 0.32, // ~-26 LUFS à l'oreille : présent, jamais envahissant
    fileFadeInMs: 1200,
    // Longueur musicale exacte de la boucle (40 mesures à 70 BPM).
    // Web Audio coupe précisément ici : le padding ajouté par l'encodeur MP3
    // n'est jamais joué, donc aucun silence au raccord.
    loopEnd: 137.142857,
    // Préchargement discret en tâche de fond (hors Data Saver et réseau lent).
    // À passer sur false pour ne jamais rien télécharger avant un survol.
    prefetchOnIdle: true,

    // Nappe synthétisée (fallback par défaut)
    oscillators: [110, 110.42, 164.81], // 3 sinus légèrement désaccordés
    lowpassHz: 900,
    lowpassQ: 0.7,
    targetGain: 0.07,
    fadeInSec: 1.1,
    fadeOutSec: 0.45
  };

  /* ---------------------------------------------------------------------------
     FABRIQUE
     ------------------------------------------------------------------------ */
  function createSoundToggle(button) {
    if (!button) return null;

    var polyline = button.querySelector("polyline");
    if (!polyline) return null;

    var reduced = global.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    var isOn = false;
    var rafId = null;
    var releaseRafId = null;

    // --- Audio ---
    var ctx = null;
    var masterGain = null;
    var filter = null;
    var oscNodes = [];
    var audioEl = null; // repli <audio> si Web Audio refuse le fichier
    var fileFadeTimer = null;
    var fileGain = null;
    var fileSource = null;
    var bufferPromise = null;
    var bytesPromise = null;
    var decodeStarted = false;

    /* -------------------------------------------------------------------------
       1. GÉNÉRATION DES POINTS
       30 points répartis uniformément entre x = 0 et x = 20 (pas de 20/29).
       ---------------------------------------------------------------------- */
    var STEP = VIEW_W / (POINTS - 1);

    function renderPoints(amplitudeFn) {
      var out = "";
      for (var i = 0; i < POINTS; i++) {
        var x = i * STEP;
        var y = amplitudeFn(i);
        out += x.toFixed(3) + "," + y.toFixed(3) + " ";
      }
      polyline.setAttribute("points", out.trim());
    }

    /** Ligne parfaitement droite et horizontale : tous les y à 0. */
    function renderFlat() {
      renderPoints(function () {
        return 0;
      });
    }

    /** Onde figée, légèrement ondulée — état ON en reduced-motion. */
    function renderStaticWave() {
      renderPoints(function (i) {
        return Math.sin((i / POINTS) * Math.PI * 2) * STATIC_AMPLITUDE;
      });
    }

    /** Une frame de l'onde animée, déphasée par le temps réel. */
    function renderWave(now, amplitude) {
      renderPoints(function (i) {
        return Math.sin((i / POINTS) * Math.PI * 2 + now * SPEED) * amplitude;
      });
    }

    /* -------------------------------------------------------------------------
       2. BOUCLE D'ANIMATION
       ---------------------------------------------------------------------- */
    function loop() {
      renderWave(performance.now(), AMPLITUDE);
      rafId = requestAnimationFrame(loop);
    }

    function startWave() {
      if (reduced) {
        renderStaticWave(); // pas de mouvement continu
        return;
      }
      if (releaseRafId) {
        cancelAnimationFrame(releaseRafId);
        releaseRafId = null;
      }
      if (rafId === null) rafId = requestAnimationFrame(loop);
    }

    /** Retour à la ligne droite : amplitude ramenée à 0 en ~250 ms. */
    function stopWave() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (reduced) {
        renderFlat();
        return;
      }

      var DURATION = 250;
      var startTime = performance.now();

      function release(now) {
        var t = Math.min(1, (now - startTime) / DURATION);
        var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        renderWave(now, AMPLITUDE * (1 - eased));

        if (t < 1) {
          releaseRafId = requestAnimationFrame(release);
        } else {
          releaseRafId = null;
          renderFlat();
        }
      }
      releaseRafId = requestAnimationFrame(release);
    }

    /* -------------------------------------------------------------------------
       3. AUDIO
       Rien ne démarre sans geste utilisateur : le clic sur ce bouton EST
       le geste qui débloque la politique d'autoplay des navigateurs.
       ---------------------------------------------------------------------- */
    /**
     * Crée le contexte audio, et ne le RÉVEILLE que si on le demande.
     * Un contexte créé sans geste utilisateur naît "suspended" : c'est
     * parfaitement légal et totalement silencieux — ça permet de décoder la
     * piste à l'avance, avant même le premier clic.
     */
    function getContext(resume) {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (resume && ctx.state === "suspended") {
        var r = ctx.resume();
        if (r && r.catch) r.catch(function () {});
      }
      return ctx;
    }

    function ensureContext() {
      return getContext(true);
    }

    /** Nappe : 3 sinus désaccordés → lowpass → gain qui monte progressivement. */
    function startSynth() {
      var context = ensureContext();
      if (!context) return;

      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = AUDIO.lowpassHz;
      filter.Q.value = AUDIO.lowpassQ;

      masterGain = context.createGain();
      masterGain.gain.value = 0;

      filter.connect(masterGain);
      masterGain.connect(context.destination);

      oscNodes = AUDIO.oscillators.map(function (freq) {
        var osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;

        var g = context.createGain();
        g.gain.value = 1 / AUDIO.oscillators.length; // évite la saturation

        osc.connect(g);
        g.connect(filter);
        osc.start();
        return { osc: osc, gain: g };
      });

      var now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(
        AUDIO.targetGain,
        now + AUDIO.fadeInSec
      );
    }

    /* --- Piste perso : Web Audio en priorité ---------------------------------
       Un <audio loop> rejoue le padding ajouté par l'encodeur MP3 : un petit
       trou revient toutes les 2 min 17 et trahit la boucle. AudioBufferSource
       boucle sur un intervalle exact, donc raccord parfaitement inaudible.
       Trois niveaux de repli, tous silencieux : Web Audio → <audio> → nappe. */

    function decode(context, arrayBuffer) {
      // Safari ancien n'a que la forme à callbacks.
      return new Promise(function (resolve, reject) {
        var p = context.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }

    /** Étape 1 : les octets (1,57 Mo). Mis en cache HTTP, réutilisables. */
    function loadBytes() {
      if (!bytesPromise) {
        bytesPromise = fetch(AUDIO.file).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        });
      }
      return bytesPromise;
    }

    /** Étape 2 : le décodage PCM. C'est lui qui rend la lecture instantanée. */
    function loadBuffer(context) {
      if (!bufferPromise) {
        bufferPromise = loadBytes().then(function (bytes) {
          // decodeAudioData "détache" le tampon qu'on lui passe : on lui donne
          // une copie, pour pouvoir redécoder si un repli en a besoin.
          return decode(context, bytes.slice(0));
        });
      }
      return bufferPromise;
    }

    /**
     * PRÉCHARGEMENT.
     *   deep = false → on ne récupère que les octets (cache HTTP chaud).
     *   deep = true  → on décode aussi : au clic, le son part sans latence.
     * Le décodage garde le PCM en mémoire, donc on ne le déclenche que sur une
     * intention claire (survol souris, focus clavier), jamais en tâche de fond.
     */
    function prefetch(deep) {
      if (!AUDIO.useFile) return;

      loadBytes().catch(function () {
        bytesPromise = null;
      });

      if (!deep || decodeStarted) return;
      var context = getContext(false); // créé en veille : aucun son émis
      if (!context) return;
      decodeStarted = true;
      loadBuffer(context).catch(function () {
        bufferPromise = null;
        decodeStarted = false;
      });
    }

    function stopFileNodes() {
      if (fileSource) {
        try {
          fileSource.stop();
        } catch (e) {
          /* déjà arrêtée */
        }
        fileSource.disconnect();
        fileSource = null;
      }
      if (fileGain) {
        fileGain.disconnect();
        fileGain = null;
      }
    }

    function startFile() {
      var context = ensureContext();
      if (!context) return startElementFallback();

      loadBuffer(context)
        .then(function (buffer) {
          if (!isOn) return; // recoupé pendant le chargement
          stopFileNodes();

          fileGain = context.createGain();
          fileGain.gain.value = 0;
          fileGain.connect(context.destination);

          fileSource = context.createBufferSource();
          fileSource.buffer = buffer;
          fileSource.loop = true;
          fileSource.loopStart = 0;
          fileSource.loopEnd = Math.min(AUDIO.loopEnd, buffer.duration);
          fileSource.connect(fileGain);
          fileSource.start(0, 0);

          var now = context.currentTime;
          fileGain.gain.setValueAtTime(0, now);
          fileGain.gain.linearRampToValueAtTime(
            AUDIO.fileVolume,
            now + AUDIO.fileFadeInMs / 1000
          );
        })
        .catch(function () {
          bufferPromise = null;
          startElementFallback();
        });
    }

    /** Repli : <audio loop> classique (raccord moins net, mais ça joue). */
    function startElementFallback() {
      if (!audioEl) {
        audioEl = new Audio(AUDIO.file);
        audioEl.loop = true;
        audioEl.preload = "auto";
        audioEl.addEventListener("error", function () {
          audioEl = null;
          AUDIO.useFile = false;
          if (isOn) startSynth();
        });
      }

      audioEl.volume = 0;
      var playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          audioEl = null;
          AUDIO.useFile = false;
          if (isOn) startSynth();
        });
      }

      var steps = 30;
      var stepMs = AUDIO.fileFadeInMs / steps;
      var i = 0;
      clearInterval(fileFadeTimer);
      fileFadeTimer = setInterval(function () {
        i++;
        if (!audioEl) return clearInterval(fileFadeTimer);
        audioEl.volume = Math.min(AUDIO.fileVolume, (i / steps) * AUDIO.fileVolume);
        if (i >= steps) clearInterval(fileFadeTimer);
      }, stepMs);
    }

    function startAudio() {
      if (AUDIO.useFile) startFile();
      else startSynth();
    }

    /** Fade-out puis arrêt RÉEL des sources (pas un simple mute). */
    function stopAudio() {
      // --- piste Web Audio ---
      if (ctx && fileGain) {
        var t = ctx.currentTime;
        var g = fileGain;
        var src = fileSource;
        fileGain = null;
        fileSource = null;

        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + AUDIO.fadeOutSec);

        setTimeout(function () {
          try {
            if (src) src.stop();
          } catch (e) {
            /* déjà arrêtée */
          }
          if (src) src.disconnect();
          g.disconnect();
          if (ctx && ctx.state === "running" && !isOn) ctx.suspend();
        }, AUDIO.fadeOutSec * 1000 + 60);
      }

      // --- repli <audio> ---
      if (audioEl) {
        clearInterval(fileFadeTimer);
        var steps = 18;
        var stepMs = (AUDIO.fadeOutSec * 1000) / steps;
        var from = audioEl.volume;
        var i = 0;
        fileFadeTimer = setInterval(function () {
          i++;
          if (!audioEl) return clearInterval(fileFadeTimer);
          audioEl.volume = Math.max(0, from * (1 - i / steps));
          if (i >= steps) {
            clearInterval(fileFadeTimer);
            audioEl.pause();
            audioEl.currentTime = 0;
          }
        }, stepMs);
      }

      // --- nappe synthétisée ---
      if (ctx && masterGain) {
        var now = ctx.currentTime;
        var current = masterGain.gain.value;

        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(current, now);
        masterGain.gain.linearRampToValueAtTime(0, now + AUDIO.fadeOutSec);

        var nodes = oscNodes;
        var oldGain = masterGain;
        var oldFilter = filter;
        oscNodes = [];
        masterGain = null;
        filter = null;

        setTimeout(function () {
          nodes.forEach(function (n) {
            try {
              n.osc.stop();
            } catch (e) {
              /* déjà arrêté */
            }
            n.osc.disconnect();
            n.gain.disconnect();
          });
          if (oldFilter) oldFilter.disconnect();
          if (oldGain) oldGain.disconnect();
          // Contexte mis en veille (et non détruit) : réutilisable au prochain clic.
          if (ctx && ctx.state === "running" && !isOn) ctx.suspend();
        }, AUDIO.fadeOutSec * 1000 + 60);
      }
    }

    /* -------------------------------------------------------------------------
       4. TOGGLE
       ---------------------------------------------------------------------- */
    function remember(value) {
      try {
        global.localStorage.setItem(STORAGE_KEY, value);
      } catch (e) {
        /* navigation privée, stockage bloqué : on continue sans mémoire */
      }
    }

    function recall() {
      try {
        return global.localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        return null;
      }
    }

    function setState(next) {
      isOn = next;
      remember(isOn ? "on" : "off");
      button.setAttribute("aria-pressed", String(isOn));
      button.setAttribute("aria-label", isOn ? "Couper le son" : "Activer le son");

      if (isOn) {
        startWave();
        startAudio();
      } else {
        stopWave();
        stopAudio();
      }
    }

    function onClick() {
      setState(!isOn);
    }

    /* -------------------------------------------------------------------------
       5. NETTOYAGE
       ---------------------------------------------------------------------- */
    function destroy() {
      button.removeEventListener("click", onClick);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (releaseRafId !== null) cancelAnimationFrame(releaseRafId);
      clearInterval(fileFadeTimer);

      oscNodes.forEach(function (n) {
        try {
          n.osc.stop();
        } catch (e) {
          /* noop */
        }
        n.osc.disconnect();
        n.gain.disconnect();
      });
      oscNodes = [];

      if (filter) filter.disconnect();
      if (masterGain) masterGain.disconnect();
      if (audioEl) {
        audioEl.pause();
        audioEl = null;
      }
      stopFileNodes();
      document.removeEventListener("visibilitychange", onVisibility);
      if (ctx && ctx.state !== "closed") ctx.close();
      ctx = null;
    }

    /* -------------------------------------------------------------------------
       6. INIT
       ---------------------------------------------------------------------- */
    /** Onglet en arrière-plan : on suspend réellement le son, on ne le mute pas. */
    function onVisibility() {
      if (!isOn) return;
      if (document.hidden) {
        if (audioEl) audioEl.pause();
        if (ctx && ctx.state === "running") ctx.suspend();
      } else {
        if (ctx && ctx.state === "suspended") ctx.resume();
        if (audioEl) audioEl.play().catch(function () {});
      }
    }

    renderFlat(); // état OFF au chargement : aucune onde, aucun son
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);

    /* Préchargement au survol / au focus clavier : entre le moment où la souris
       arrive sur le bouton et le clic, il s'écoule 300 à 600 ms — largement de
       quoi télécharger ET décoder la piste. Le son part alors instantanément. */
    button.addEventListener("pointerenter", function (e) {
      prefetch(!e.pointerType || e.pointerType === "mouse");
    });
    button.addEventListener("focus", function () {
      prefetch(true);
    });
    button.addEventListener(
      "touchstart",
      function () {
        // Pas de survol sur mobile : le doigt qui se pose sur le bouton EST
        // l'intention. On lance le décodage sans attendre le clic.
        prefetch(true);
      },
      { passive: true }
    );

    /* Mobile / tactile : pas de survol possible. On réchauffe donc le cache une
       fois la page chargée et le navigateur au repos — mais jamais en Data
       Saver ni sur un réseau lent, où 1,57 Mo se paient cher. */
    if (AUDIO.prefetchOnIdle) {
      var warm = function () {
        var conn = global.navigator && global.navigator.connection;
        if (conn && (conn.saveData || /(^|-)(2g|3g)$/.test(conn.effectiveType || ""))) {
          return;
        }
        var idle = global.requestIdleCallback || function (fn) { return setTimeout(fn, 1); };
        idle(function () {
          prefetch(false);
        });
      };

      if (document.readyState === "complete") setTimeout(warm, 3000);
      else global.addEventListener("load", function () { setTimeout(warm, 3000); });
    }

    /* Le visiteur avait activé le son lors d'une visite précédente : on le
       relance — mais seulement au premier geste réel (clic, touche, scroll
       tactile). Aucun navigateur n'autorise le son avant, et personne ne doit
       recevoir de musique sans l'avoir demandée une première fois. */
    if (recall() === "on") {
      var resume = function () {
        detach();
        if (!isOn) setState(true);
      };
      var detach = function () {
        ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
          document.removeEventListener(evt, resume, true);
        });
      };
      ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
        document.addEventListener(evt, resume, true);
      });
    }

    return { destroy: destroy, isOn: function () { return isOn; } };
  }

  /* ---------------------------------------------------------------------------
     AUTO-INIT (une seule instance, quel que soit le moment d'exécution)
     ------------------------------------------------------------------------ */
  global.createSoundToggle = createSoundToggle;

  var instance = null;
  function autoInit() {
    if (instance) return; // garde-fou : jamais deux écouteurs sur le bouton
    var btn = document.getElementById("sound-toggle");
    if (!btn) return;
    instance = createSoundToggle(btn);
    global.soundToggle = instance;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})(window);
