# Marvin Ahanda — Portfolio

Portfolio d'ingénieur agents IA & automatisation.
**En ligne : https://portfolio.nexiaacademy.net**

> Je conçois, déploie et maintiens des systèmes multi-agents en production —
> agents WhatsApp et vocaux, workflows n8n, architectures multi-agents.
> 16 systèmes livrés, 8 secteurs.

---

## Stack

Site statique, sans framework et sans dépendance CDN : un seul fichier CSS écrit
à la main, trois scripts, aucune requête tierce.

| Brique | Choix | Pourquoi |
|---|---|---|
| Structure | HTML statique | Chargement immédiat, rien à builder, rien à maintenir |
| Styles | CSS natif (design system par tokens) | Pas de runtime JS de styling, budget Lighthouse tenu |
| Physique du hero | [Matter.js](https://brm.io/matter-js/) 0.20 | Les badges d'outils tombent et s'empilent réellement |
| Orchestration | [GSAP](https://gsap.com/) 3.12 | Séquencement des apparitions |
| Typographie | Inter auto-hébergée (woff2) | Aucune requête Google Fonts |
| Audio | Web Audio API | Boucle ambient sans raccord audible |

## Parti pris techniques

- **Amélioration progressive.** Sans JavaScript, sans Matter.js ou en
  `prefers-reduced-motion`, le hero reste une grille statique parfaitement
  lisible. Aucune fonctionnalité n'est bloquante.
- **Zéro CDN.** Polices, librairies, logos : tout est auto-hébergé. Le site
  fonctionne hors ligne une fois chargé et ne fuite rien vers un tiers.
- **Animations qui s'arrêtent.** La physique du hero et la démo animée passent
  en pause dès qu'elles sortent de l'écran ou que l'onglet perd le focus.
- **Son opt-in.** Aucune lecture automatique. La piste est préchargée au survol
  du bouton pour démarrer sans latence, jamais en Data Saver ni en 2G/3G.
- **Accessibilité.** Lien d'évitement, `aria-*` sur les contrôles, focus
  clavier géré, contrastes conformes AA.

## Structure

```
.
├── index.html              Page unique
├── 404.html
├── assets/
│   ├── style.css           Design system + styles
│   ├── main.js             Nav, révélations, compteurs, démo
│   ├── hero-physics.js     Chute et empilement des badges (Matter.js)
│   ├── sound-toggle.js     Onde animée + moteur audio (Web Audio)
│   ├── matter.min.js  gsap.min.js
│   ├── inter-latin-*.woff2
│   └── photo-*.jpg  og-image.png  favicon.svg
├── audio/ambient.mp3       Boucle 40 mesures à 70 BPM, -16 LUFS
├── netlify.toml            En-têtes, cache, redirections
├── robots.txt  sitemap.xml  .nojekyll
```

## Développement

Aucune étape de build. Un serveur statique suffit :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

**Hébergement** : Netlify (production, https://portfolio.nexiaacademy.net).
Ce dépôt GitHub reste la source de vérité du code ; la configuration Netlify
(en-têtes, cache, redirections) est versionnée dans `netlify.toml`.

## Contact

- **WhatsApp** — [+237 653 724 075](https://wa.me/237653724075)
- **E-mail** — contact@nexiaacademy.net
- **LinkedIn** — [marvin-brice-ahanda](https://www.linkedin.com/in/marvin-brice-ahanda)
- **NexIA Academy** — [nexiaacademy.net](https://www.nexiaacademy.net)

---

© 2026 Marvin Ahanda. Code et contenu de ce portfolio : tous droits réservés.
Matter.js et GSAP restent sous leurs licences respectives.
