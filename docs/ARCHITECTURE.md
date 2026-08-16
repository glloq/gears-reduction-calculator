# Architecture Technique

## Vue d'ensemble

Application web monopage (SPA) en JavaScript vanilla pour le calcul et la visualisation de trains de réduction d'engrenages. Aucun framework, aucun build step.

## Structure des dossiers

```
gears-reduction-calculator/
├── index.html                 # Page unique : sidebar modulaire + espace maître/détail
├── css/                       # Système de design (jetons + couches)
│   ├── theme.css              # Jetons de design (couleurs, espacements) + thème sombre
│   ├── base.css               # Reset, typographie, contrôles de formulaire, boutons
│   ├── layout.css             # En-tête, sidebar, grille maître/détail, responsive
│   ├── components.css         # Modules de la sidebar : panneaux, chips, sliders, résumé
│   └── workspace.css          # Solutions, onglets de détail, schéma, analyse, graphiques
├── js/
│   ├── namespace.js           # Namespace GearApp (chargé en premier)
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
│   │   ├── ResultsTable.js    # Tableau de résultats et sélection
│   │   ├── MechanicalPanel.js # Panneau d'analyse mécanique détaillée
│   │   ├── ParameterForm.js   # Sliders de dents, thème, mode expert, accesseurs
│   │   ├── Workbench.js       # Comportement de l'interface : contexte d'objectif,
│   │   │                      #   paramètres par type, gabarit d'architecture,
│   │   │                      #   onglets de détail, tuiles de solutions
│   │   ├── SolutionFilter.js  # Filtrage/tri pur du vivier (UMD, testé sous Node)
│   │   ├── SolutionExplorer.js# Vivier de solutions + barre d'affinage instantané
│   │   ├── StageEditor.js     # Éditeur d'étages : ré-analyse locale, variantes
│   │   ├── ComparePanel.js    # Épingles (max 4) et comparaison côte à côte
│   │   ├── ExportManager.js   # Export SVG/PNG, contrôle animation
│   │   └── UIController.js    # Orchestrateur UI principal
│   ├── visualization/
│   │   ├── core/              # Socle commun aux TROIS vues (UMD, testé Node)
│   │   │   ├── SceneBuilder.js       # Modèle graphique canonique d'une solution
│   │   │   ├── KinematicsEngine.js   # Source unique des vitesses et des sens
│   │   │   ├── AnimationController.js# Horloge d'animation partagée
│   │   │   ├── ViewportController.js # Zoom/pan/pincement identiques partout
│   │   │   ├── GeometryUtils.js      # Tangentes et enroulements exacts
│   │   │   └── SvgExport.js          # Export SVG/PNG unique (dont SVG technique)
│   │   ├── teeth/             # Vue « Denture »
│   │   │   ├── ToothProfile.js       # Développante, couronne dentée
│   │   │   ├── ToothProfileCache.js  # Cache de profils (roues identiques)
│   │   │   ├── TeethPrimitives.js    # Corps de roue par famille + LOD 0→3
│   │   │   └── TeethOverlay.js       # Cercles de construction, ligne d'action
│   │   ├── geometry/          # Vue « Géométrie 2D »
│   │   │   ├── GeometryLayout.js     # Placement aux cotes réelles
│   │   │   ├── GeometryPrimitives.js # Conventions de trait
│   │   │   └── DimensionRenderer.js  # Cotation par étage et enveloppe globale
│   │   ├── kinematic/         # Vue « Cinématique » (layout + primitives)
│   │   ├── overlays/          # Efforts et alertes mécaniques, partagés
│   │   ├── TrainLayout.js     # Placement pur de la vue denture (UMD, testé Node)
│   │   ├── TrainRenderer.js   # Orchestrateur de la vue Denture
│   │   ├── GeometryRenderer.js# Orchestrateur de la vue Géométrie 2D
│   │   ├── StageInspector.js  # Carte d'inspection partagée par les trois vues
│   │   ├── ViewerToolbar.js   # État partagé : vue, sélection, animation, overlays
│   │   ├── GearCharts.js      # Proxy namespace pour GearCharts
│   │   └── LegacySchema.js    # Schéma Canvas 2D encapsulé en classe
│   ├── Charts.js              # Graphiques Chart.js (code actif)
│   ├── app.js                 # Point d'entrée : bootstrap et câblage
│   └── [fichiers legacy]      # Conservés pour compatibilité
└── docs/
    ├── ARCHITECTURE.md        # Ce document
    ├── TECHNICAL_CHOICES.md   # Choix techniques détaillés
    └── DEVELOPMENT_HISTORY.md # Historique des étapes de développement
```

## Couches architecturales

### 1. Models (`js/models/`)
Données et structures. Aucune dépendance vers l'UI ou la visualisation.

- **TransmissionTypeRegistry** : Registre centralisé des 7 types de transmission. Chaque type définit : rapport, rendement, géométrie, contraintes, labels, couleur SVG.
- **SearchParams** : Value object encapsulant tous les paramètres de recherche. Méthodes `fromForm()`, `validate()`, `toWorkerParams()`, `save()`/`restore()`.

### 2. Core (`js/core/`)
Logique métier et infrastructure. Dépend uniquement des models.

- **EventBus** : Système pub/sub simple (`on`, `off`, `emit`). Découple le moteur de recherche de l'UI.
- **GearMechanics** : Calculs d'ingénierie (Lewis, rendement Merritt, rapport de conduite, interférence, jeu de denture).
- **Engine** : Orchestrateur de recherche. Utilise un Web Worker si disponible, sinon fallback synchrone. Communique via EventBus.
- **worker.js** : Web Worker autonome. Duplique les contraintes des types (le worker n'a pas accès au DOM).

### 3. UI (`js/ui/`)
Composants d'interface. Dépend de core et models.

- **Logger** : Gestion du panneau de logs et du statut.
- **ResultsTable** : Affichage du tableau, sélection de solution, émet `solution:selected`.
- **MechanicalPanel** : Construction HTML de l'analyse mécanique détaillée.
- **ParameterForm** : Sliders noUiSlider, thème, sauvegarde/restauration localStorage.
- **ExportManager** : Export SVG/PNG, animation.
- **UIController** : Orchestrateur qui connecte tous les sous-composants via EventBus.

### 4. Visualization (`js/visualization/`)
Rendu graphique. Dépend de core pour les données.

**Règle d'architecture n° 1 : aucun renderer ne recalcule le fonctionnement
mécanique.** Les trois vues ne sont pas trois implémentations du même réducteur,
ce sont trois lectures du même modèle. Toute vitesse, tout sens de rotation,
toute cote vient du moteur ; un renderer ne fait que placer et dessiner.

```
Solution
   │
   ▼
SceneBuilder ──────────► KinematicsEngine ──► AnimationController
   │ géométrie réelle          │ ω, sens, Willis, translations
   │ membres, arbres           │
   ▼                           ▼
TrainLayout / GeometryLayout / KinematicLayoutEngine
   │
   ▼
TrainRenderer   GeometryRenderer   KinematicRenderer
        └──── ViewportController · SvgExport · StageInspector ────┘
                    overlays/ForceOverlay · overlays/WarningOverlay
```

- **SceneBuilder** : modèle graphique canonique dérivé d'une solution. Ne
  fabrique aucune dimension : il consomme `stage.geometry`, `solution.mechanical`
  et le registre de transmissions.
- **KinematicsEngine** : source unique de la cinématique. `build(solution)` donne
  la vitesse signée de chaque membre (y compris satellites : rotation propre +
  orbite du porte-satellites, via la relation de Willis du registre) ;
  `pose(state, angle)` donne l'état instantané pour un angle d'entrée en degrés,
  y compris translations de crémaillère et défilement de courroie en mm réels.
- **AnimationController / ViewportController** : horloge et zoom/pan communs. Le
  zoom est ancré au pointeur, borné relativement à la vue ajustée, et supporte le
  pincement tactile — même comportement dans les trois vues.
- **TrainRenderer + TrainLayout + teeth/** : vue « Denture ». Profils en
  développante aux cotes calculées, avec un **niveau de détail piloté par la
  taille réelle à l'écran** (silhouette → dents simplifiées → développante →
  tracés de construction). Représentations propres à chaque famille : stries et
  sens d'hélice, couronne intérieure, filet de vis sans fin, cônes primitifs sur
  axes concourants, crémaillère au pas réel.
- **GeometryRenderer + geometry/** : vue de DIMENSIONNEMENT. Couches activables
  (`envelope · shaft · geometry · pitch · dimension · force · label`), cotation
  des diamètres, entraxes, largeurs et modules réellement calculés, enveloppe
  globale. Une cote absente n'est pas tracée, jamais inventée.
- **KinematicRenderer + kinematic/** : schéma symbolique où **l'arbre est
  l'élément principal** — chaque arbre porte son identifiant, sa vitesse et son
  sens ; les symboles de liaison viennent ensuite. Projections principale,
  orthogonale et automatique, flux de puissance animé.
- **ViewerToolbar** : détient l'état partagé (vue, étage sélectionné, lecture et
  vitesse d'animation, overlays) et le réapplique à chaque changement de vue.
  Contrat d'évènements unique : `viewer:stage-selected`, `viewer:stage-edit`,
  `viewer:view-changed`, `viewer:overlay-changed`, `viewer:animation-changed`.
- **StageInspector / ForceOverlay / WarningOverlay** : inspection, efforts
  (Ft/Fr/Fa normalisés) et alertes mécaniques structurées, partagés par les vues.
- **GearCharts** : 4 graphiques Chart.js (ratio, radar, cascade, pertes).
- **LegacySchema** : Schéma Canvas 2D classique (conservé dans `<details>`).

## Flux de données

```
[Utilisateur] → ParameterForm → SearchParams → Engine → Worker
                                                          ↓
[Worker] → EventBus:search:progress → Logger + ProgressBar
[Worker] → EventBus:search:done → ResultsTable.display()
                                       ↓
                              EventBus:solution:selected
                              ↓           ↓           ↓
                       ViewerToolbar MechanPanel   LegacySchema
                                         ↓
                                     GearCharts
```

## Événements EventBus

| Événement | Source | Consommateurs |
|---|---|---|
| `search:log` | Engine | Logger |
| `search:progress` | Engine | ProgressBar |
| `solution:selected` | ResultsTable | UIController → ViewerToolbar, Panel, Charts, Legacy |

## Compatibilité

- Pas de build step (no Webpack/Vite)
- Pas de modules ES (compatibilité Worker)
- Shims `window.*` pour transition progressive
- Fonctionne avec `<script defer>` (ordre d'exécution garanti)
