# Historique de Développement

## Phase 1 : Fondations (version initiale)

### Objectif
Calculateur basique de rapports de réduction par engrenages droits.

### Implémentation
- **index.html** : Page unique avec formulaire de paramètres et tableau de résultats
- **js/Engine.js** : Algorithme de recherche exhaustive synchrone (DFS avec élagage)
- **js/schema.js** : Schéma Canvas 2D linéaire des engrenages
- **styles.css** : Styles basiques

### Fonctionnalités
- Recherche de combinaisons d'engrenages pour un rapport cible
- Plages min/max pour dents menante et menée (noUiSlider)
- Nombre d'étages configurable (1 à 8)
- Précision configurable (% d'écart toléré)
- Affichage des résultats triés par proximité au rapport cible
- Schéma Canvas 2D des engrenages sélectionnés

### Limitations
- Calcul bloquant (thread principal gelé pendant la recherche)
- Engrenages droits uniquement
- Pas d'analyse mécanique (juste le rapport)
- Schéma Canvas basique sans interaction

---

## Phase 2 : Calculs avancés et visualisation interactive

### Objectif
Ajouter des calculs d'ingénierie mécanique et une visualisation SVG interactive.

### Nouveaux fichiers
- **js/worker.js** : Web Worker pour recherche non-bloquante
- **js/GearMechanics.js** : Module de calculs mécaniques avancés
- **js/GearSVG.js** : Visualisation SVG interactive avec profils de dents développante
- **js/Charts.js** : Graphiques Chart.js de comparaison et d'analyse
- **js/UI.js** : Gestionnaire d'affichage centralisé

### Améliorations
- **Web Worker** : Calcul en arrière-plan avec progression temps réel
- **Analyse mécanique** : Rendement (Merritt), résistance (Lewis), rapport de conduite, interférence
- **SVG interactif** : Zoom molette, pan clic-glisser, tooltips au survol, profils développante
- **Graphiques** : 4 graphiques Chart.js (ratio, radar, cascade, pertes)
- **Export** : SVG vectoriel et PNG bitmap
- **Animation** : Rotation des engrenages avec ratios de vitesse corrects
- **Thème sombre** : Basculement via CSS custom properties
- **Raccourcis clavier** : Ctrl+Entrée (rechercher), Échap (arrêter)
- **Persistance** : Sauvegarde/restauration des paramètres (localStorage)

### Choix techniques
- SVG plutôt que Canvas pour l'interactivité (éléments DOM cliquables)
- Chart.js CDN plutôt qu'une bibliothèque locale
- Canvas legacy conservé dans `<details>` pour compatibilité

---

## Phase 3 : Support multi-types de transmission

### Objectif
Permettre la recherche et l'analyse avec 7 types de transmission différents.

### Nouveau fichier
- **js/TransmissionTypes.js** : Registre des 7 types de transmission

### Types implémentés

| Type | Rapport | Axes | Rendement | Particularités |
|---|---|---|---|---|
| Engrenage droit | B/A | Parallèles | 90-98% | Standard, réversible |
| Hélicoïdal | B/A | Parallèles | 92-99% | Silencieux, module apparent |
| Intérieur | B/A | Parallèles | 94-99% | Compact, même sens rotation |
| Conique | B/A | 90° | 88-96% | Changement direction axes |
| Courroie/poulie | B/A | Parallèles | 93-98% | Amortissement vibrations |
| Épicycloïdal | 1+B/A | Coaxial | 95-97% | Très compact, haut ratio |
| Vis sans fin | B/A | 90° | 30-90% | Très haut ratio, irréversible |

### Modifications
- **worker.js** : Recherche multi-types avec contraintes par type
- **Engine.js** : Paramètre `typesActifs`
- **GearMechanics.js** : Analyse type-aware (rendement, résistance, géométrie spécifiques)
- **GearSVG.js** : 5 nouvelles méthodes de dessin (interne, vis, courroie, conique, épicycloïdal)
- **UI.js** : Colonne Types avec badges, rapport type-aware, détails géométrie par type
- **Charts.js** : Calcul de rapport type-aware
- **index.html** : Grille de checkboxes pour sélection des types
- **styles.css** : Badges colorés par type

### Solutions techniques
- Format solution étendu : `[A, B, typeId]` (backward compat: typeId='spur' par défaut)
- Worker: contraintes dupliquées localement (pas d'accès DOM)
- Élagage combinatoire : `maxRapportRestant` calculé sur tous les types actifs

---

## Phase 4 : Refactoring modulaire OOP

### Objectif
Restructurer le code en architecture modulaire avec séparation des responsabilités.

### Nouvelle structure
```
css/          → 8 fichiers thématiques (split du monolithique styles.css)
js/namespace.js → Namespace global GearApp
js/models/    → TransmissionTypeRegistry, SearchParams
js/core/      → EventBus, GearMechanics, Engine
js/ui/        → Logger, ResultsTable, MechanicalPanel, ParameterForm, ExportManager, UIController
js/visualization/ → GearSVG, GearCharts, LegacySchema
js/app.js     → Point d'entrée bootstrap
```

### Patterns appliqués
- **Namespace** : `GearApp.{models|core|ui|visualization}` au lieu de `window.*`
- **IIFE** : Chaque fichier encapsulé dans `(function(GearApp) { ... })(GearApp)`
- **Pub/Sub** : EventBus pour découpler Engine de l'UI
- **Value Object** : SearchParams pour encapsuler les paramètres
- **Orchestrateur** : UIController coordonne les sous-composants UI

### Améliorations clé
- **Engine découplé** : Ne dépend plus de `UI.ajouterLog()`, utilise EventBus
- **UI décomposée** : 506 lignes monolithiques → 6 classes avec responsabilités claires
- **CSS modulaire** : 683 lignes → 8 fichiers thématiques
- **Schema encapsulé** : Constantes et fonctions globales → classe LegacySchema

---

## Phase 5 (en cours) : Étude UX et système de comparaison

### Objectifs
- Étude de l'interface utilisateur (design, arrangement, logique d'utilisation)
- Tri et classement des résultats par types
- Système de comparaison multi-sorties (plusieurs rapports cibles)
- Optimisation de l'interface selon les besoins utilisateur
