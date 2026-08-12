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
│   │   │                      #   paramètres par type, onglets de détail, tuiles
│   │   ├── ExportManager.js   # Export SVG/PNG, contrôle animation
│   │   └── UIController.js    # Orchestrateur UI principal
│   ├── visualization/
│   │   ├── GearSVG.js         # Proxy namespace pour GearSVG
│   │   ├── GearCharts.js      # Proxy namespace pour GearCharts
│   │   └── LegacySchema.js    # Schéma Canvas 2D encapsulé en classe
│   ├── GearSVG.js             # Visualisation SVG interactive (code actif)
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

- **GearSVG** : SVG interactif avec zoom/pan/tooltips. Dessins spécifiques par type.
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
                          GearSVG    MechanPanel   LegacySchema
                                         ↓
                                     GearCharts
```

## Événements EventBus

| Événement | Source | Consommateurs |
|---|---|---|
| `search:log` | Engine | Logger |
| `search:progress` | Engine | ProgressBar |
| `solution:selected` | ResultsTable | UIController → SVG, Panel, Charts, Legacy |

## Compatibilité

- Pas de build step (no Webpack/Vite)
- Pas de modules ES (compatibilité Worker)
- Shims `window.*` pour transition progressive
- Fonctionne avec `<script defer>` (ordre d'exécution garanti)
