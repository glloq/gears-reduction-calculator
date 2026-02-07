# Architecture Technique

## Vue d'ensemble

Application web monopage (SPA) en JavaScript vanilla pour le calcul et la visualisation de trains de réduction d'engrenages. Aucun framework, aucun build step.

## Structure des dossiers

```
gears-reduction-calculator/
├── index.html                 # Page unique, point d'entrée HTML
├── css/                       # Styles modulaires (8 fichiers)
│   ├── variables.css          # Custom properties CSS + thème sombre
│   ├── base.css               # Reset, typographie, animations
│   ├── layout.css             # Layout flex principal, sidebar, content
│   ├── components.css         # Boutons, inputs, sliders, badges types
│   ├── results.css            # Tableau résultats, progress bar, indicateurs
│   ├── mechanical.css         # Panneau analyse mécanique, cartes, géométrie
│   ├── visualization.css      # SVG, Canvas legacy, graphiques, logs
│   └── responsive.css         # Media queries (@media 1024/768/480px)
├── js/
│   ├── namespace.js           # Namespace GearApp (chargé en premier)
│   ├── config/
│   │   └── Constants.js       # Constantes globales, seuils, paramètres par défaut
│   ├── models/
│   │   ├── TransmissionTypeRegistry.js  # Registre des 7 types de transmission
│   │   └── SearchParams.js              # Paramètres de recherche (value object)
│   ├── core/
│   │   ├── EventBus.js        # Pub/sub pour découplage inter-modules
│   │   ├── GearMechanics.js   # Calculs mécaniques (Lewis, rendement, conduite)
│   │   ├── Engine.js          # Moteur de recherche (Worker + fallback)
│   │   └── worker.js          # Web Worker autonome pour recherche non-bloquante
│   ├── ui/
│   │   ├── Logger.js          # Gestion des logs et statut
│   │   ├── ResultsTable.js    # Tableau de résultats, tri, filtrage, sélection
│   │   ├── MechanicalPanel.js # Panneau d'analyse mécanique détaillée
│   │   ├── ParameterForm.js   # Formulaire, sliders, thème, sauvegarde
│   │   ├── ExportManager.js   # Export SVG/PNG, contrôle animation
│   │   ├── ComparisonManager.js # Comparaison multi-rapports cibles
│   │   └── UIController.js    # Orchestrateur UI principal
│   ├── visualization/
│   │   ├── GearDrawer.js      # Mixin dessin : profils, types spéciaux, cotation
│   │   ├── SVGInteraction.js  # Mixin interaction : zoom, pan, tooltips
│   │   ├── AnimationEngine.js # Mixin animation : rotation des engrenages
│   │   ├── GearSVG.js         # Proxy namespace pour GearSVG
│   │   ├── GearCharts.js      # Proxy namespace pour GearCharts
│   │   └── LegacySchema.js    # Schéma Canvas 2D encapsulé en classe
│   ├── GearSVG.js             # Noyau SVG : constructeur, train, export
│   ├── Charts.js              # Graphiques Chart.js (code actif)
│   └── app.js                 # Point d'entrée : bootstrap et câblage
├── test/                      # Tests unitaires (Phase 3)
│   ├── helpers/
│   │   └── context.js         # Harnais VM pour charger les modules IIFE
│   ├── EventBus.test.js       # Tests pub/sub, chaînage, cas limites
│   ├── GearMechanics.test.js  # Tests calculs mécaniques (Lewis, Hertz, etc.)
│   ├── TransmissionTypeRegistry.test.js  # Tests 7 types, rapports, validation
│   └── SearchParams.test.js   # Tests paramètres, validation, conversion Worker
├── package.json               # Scripts npm (test)
└── docs/
    ├── ARCHITECTURE.md        # Ce document
    ├── TECHNICAL_CHOICES.md   # Choix techniques détaillés
    ├── DEVELOPMENT_HISTORY.md # Historique des étapes de développement
    ├── UX_STUDY.md            # Étude UX initiale
    ├── UX_STUDY_V2.md         # Étude UX v2
    ├── IMPROVEMENTS_STUDY.md  # Analyse détaillée des améliorations possibles
    └── 3D_MODULE_ARCHITECTURE.md # Plans pour la visualisation 3D future
```

## Couches architecturales

### 0. Config (`js/config/`)
Constantes globales partagées entre tous les modules.

- **Constants.js** : Centralise les magic numbers, seuils de qualité, paramètres par défaut, constantes d'ingénierie mécanique, et paramètres de visualisation. Évite la duplication de valeurs entre les fichiers.

### 1. Models (`js/models/`)
Données et structures. Aucune dépendance vers l'UI ou la visualisation.

- **TransmissionTypeRegistry** : Registre centralisé des 7 types de transmission. Chaque type définit : rapport, rendement, géométrie, contraintes, labels, couleur SVG.
- **SearchParams** : Value object encapsulant tous les paramètres de recherche. Méthodes `fromForm()`, `validate()`, `toWorkerParams()`, `save()`/`restore()`.

### 2. Core (`js/core/`)
Logique métier et infrastructure. Dépend uniquement des models.

- **EventBus** : Système pub/sub simple (`on`, `off`, `emit`). Découple le moteur de recherche de l'UI.
- **GearMechanics** : Calculs d'ingénierie (Lewis, rendement Merritt, rapport de conduite, interférence, jeu de denture, Hertz).
- **Engine** : Orchestrateur de recherche. Utilise un Web Worker si disponible, sinon fallback synchrone. Communique via EventBus.
- **worker.js** : Web Worker autonome. Duplique les contraintes des types (le worker n'a pas accès au DOM). Algorithme Branch & Bound avec approfondissement itératif.

### 3. UI (`js/ui/`)
Composants d'interface. Dépend de core et models.

- **Logger** : Gestion du panneau de logs et du statut.
- **ResultsTable** : Affichage du tableau, tri multi-colonnes, filtrage par type, sélection de solution, émet `solution:selected`.
- **MechanicalPanel** : Construction HTML de l'analyse mécanique détaillée (standard + mode pro).
- **ParameterForm** : Sliders noUiSlider, thème, mode pro, paramètres contextuels par type, sauvegarde/restauration localStorage.
- **ExportManager** : Export SVG/PNG, contrôle d'animation.
- **ComparisonManager** : Définition de N rapports cibles, recherche parallèle, tableau de comparaison.
- **UIController** : Orchestrateur qui connecte tous les sous-composants via EventBus.

### 4. Visualization (`js/visualization/`)
Rendu graphique. Dépend de core pour les données.

**GearSVG** — Architecture modulaire par mixins :
- **GearSVG.js** (noyau) : Constructeur, initialisation SVG, orchestration `drawGearTrain()`, export SVG/PNG, nettoyage. Définit la classe et expose `window.GearSVG`.
- **GearDrawer.js** (mixin) : Dessin individuel des 7 types de transmission : `drawGear()` (profil en développante de cercle), `drawInternalGear()`, `drawWormGear()`, `drawBeltPulley()`, `drawBevelGear()`, `drawEpicyclicGear()`, lignes de cote et labels E/S.
- **SVGInteraction.js** (mixin) : Zoom (molette), pan (clic-glisser), tooltips (hit areas + info-bulles SVG), cadrage automatique `_fitViewBox()`, `resetView()`.
- **AnimationEngine.js** (mixin) : Animation de rotation (`requestAnimationFrame`), calcul des rapports cumulés, sens de rotation par type, contrôle start/stop/toggle.

Les mixins ajoutent des méthodes à `GearSVG.prototype` après le chargement du noyau. L'ordre de chargement est garanti par `<script defer>`.

**Autres modules :**
- **GearCharts** : 4 graphiques Chart.js (comparaison des rapports, radar multicritères, cascade couple/vitesse, répartition des pertes).
- **LegacySchema** : Schéma Canvas 2D classique (conservé dans `<details>`).

## Flux de données

```
[Utilisateur] → ParameterForm → SearchParams → Engine → Worker
                                                          ↓
[Worker] → EventBus:search:progress → Logger + ProgressBar
[Worker] → EventBus:search:partial  → ResultsTable (affichage progressif)
[Worker] → EventBus:search:done → ResultsTable.display()
                                       ↓
                              EventBus:solution:selected
                              ↓           ↓           ↓
                          GearSVG    MechanPanel   LegacySchema
                                         ↓
                                     GearCharts
```

## Événements EventBus

| Événement | Source | Consommateurs |
|---|---|---|
| `search:log` | Engine | Logger |
| `search:progress` | Engine | ProgressBar |
| `search:partial` | Engine | ResultsTable (affichage incrémental) |
| `solution:selected` | ResultsTable | UIController → SVG, Panel, Charts, Legacy |

## Gestion des actions HTML

Les boutons utilisent des attributs `data-action` au lieu de `onclick` inline.
La correspondance action → fonction est définie dans `app.js` via `ACTION_MAP`,
avec délégation d'événements sur le document.

Actions disponibles :
- `lancerRecherche` — Lancer/arrêter la recherche
- `sauvegarderParametres` — Sauvegarder dans localStorage
- `toggleTheme` — Basculer thème clair/sombre
- `toggleProMode` — Basculer mode Standard/Pro
- `toggleComparison` — Ouvrir/fermer le panneau de comparaison
- `toggleAnimation` — Animer/arrêter les engrenages SVG
- `resetSVGView` — Recentrer la vue SVG
- `exporterSVG` / `exporterPNG` — Exporter le schéma

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+Entrée` | Lancer la recherche |
| `Échap` | Arrêter la recherche en cours |

## Compatibilité

- Pas de build step (no Webpack/Vite)
- Pas de modules ES (compatibilité Worker)
- Shims `window.*` pour transition progressive (legacy bridges dans app.js)
- Fonctionne avec `<script defer>` (ordre d'exécution garanti)
- Constantes partagées via `GearApp.config` (Constants.js)

## Conventions de code

- **IIFE + Namespace** : Tous les modules utilisent `(function(GearApp) { ... })(GearApp);`
- **Prototype pattern** : Constructeurs avec méthodes sur `Constructor.prototype.*`
- **Mixin pattern** : Les sous-modules de GearSVG ajoutent des méthodes au prototype via des IIFE séparées
- **JSDoc** : Tous les fichiers ont des en-têtes de module et des annotations JSDoc
- **Commentaires en français** : Cohérent avec l'interface utilisateur
- **Séparateurs de section** : `// ===== Nom de section =====` pour la lisibilité
- **Préfixe `_`** : Convention pour les méthodes/propriétés privées

## Conventions de nommage des mixins

Les sous-modules de `GearSVG` utilisent le pattern **mixin par prototype** :
```javascript
(function () {
  var proto = GearSVG.prototype;
  proto.nomMethode = function () { ... };
})();
```
Ce pattern permet de découper une classe monolithique en fichiers thématiques
sans changer l'API publique ni le comportement.

## Pistes d'amélioration (phases futures)

### Phase 2 — Refactoring GearSVG.js ✅
- ✅ Découpé en sous-modules : GearDrawer, SVGInteraction, AnimationEngine
- ✅ Constantes de dessin extraites dans Constants.js (SVG_CFG)
- ✅ Conversion de la classe ES6 en IIFE + prototype (cohérent avec le reste)

### Phase 3 — Tests unitaires ✅
- ✅ Framework : `node:test` + `node:assert` (zéro dépendance, Node 22 natif)
- ✅ Harnais VM (`test/helpers/context.js`) pour charger les IIFE en isolation
- ✅ 77 tests couvrant : EventBus, GearMechanics, TransmissionTypeRegistry, SearchParams
- ✅ `npm test` exécute tous les tests via `node --test test/*.test.js`

### Phase 4 — Module 3D
- Voir `docs/3D_MODULE_ARCHITECTURE.md` pour les plans détaillés
- Three.js pour le rendu 3D des engrenages
