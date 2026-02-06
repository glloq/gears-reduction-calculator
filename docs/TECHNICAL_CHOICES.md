# Choix Techniques

## 1. JavaScript Vanilla (pas de framework)

**Choix** : Aucun framework (React, Vue, Angular, etc.)

**Raisons** :
- Application à périmètre défini : calcul + visualisation d'engrenages
- Pas de gestion d'état complexe (pas de routing, pas de SPA multi-pages)
- Performance : pas de virtual DOM overhead pour des opérations SVG directes
- Simplicité de déploiement : un seul fichier HTML, pas de build
- Les calculs mécaniques sont le coeur, pas l'UI reactive

**Compromis** : Le code d'affichage HTML est plus verbeux (concaténation de strings). Acceptable vu la taille du projet.

## 2. Web Worker pour le calcul

**Choix** : Recherche exhaustive dans un Web Worker dédié

**Raisons** :
- L'algorithme de recherche peut itérer jusqu'à 5M de combinaisons
- Sans Worker, le thread principal serait bloqué → UI gelée
- Le Worker permet d'envoyer des messages de progression en temps réel
- Fallback synchrone si Worker non disponible

**Limitation** : Le Worker ne peut pas importer les modules du thread principal. Les contraintes des types sont dupliquées dans `worker.js`. Synchronisation manuelle requise.

## 3. SVG pour la visualisation interactive

**Choix** : SVG (pas Canvas) pour le schéma principal des engrenages

**Raisons** :
- SVG est un arbre DOM → chaque engrenage est un élément cliquable
- Zoom/pan natif via viewBox manipulation
- Tooltips au survol sans code supplémentaire
- Export SVG vectoriel propre (résolution infinie)
- Export PNG via conversion Canvas temporaire

**Canvas conservé** : Le schéma linéaire 2D legacy (Canvas) est conservé dans un `<details>` car il offre une vue complémentaire plus schématique.

## 4. Chart.js pour les graphiques

**Choix** : Chart.js v4.4 via CDN

**Raisons** :
- Bibliothèque mature et maintenue
- Supporte bar, line, radar nativement
- Responsive par défaut
- Chargement CDN = pas de build nécessaire
- Annotation plugin pour la ligne cible sur le graphique des rapports

**Types de graphiques** :
1. **Comparaison des rapports** (bar + line) : rapports obtenus vs cible + écarts
2. **Radar multicritères** : rendement, compacité, conduite, sécurité, précision
3. **Cascade couple/vitesse** : évolution par étage
4. **Répartition des pertes** (bar horizontal empilé) : puissance utile vs pertes

## 5. noUiSlider pour les plages

**Choix** : noUiSlider v15.7 via CDN

**Raison** : Sliders double-poignée pour min/max des dents. HTML natif `<input type="range">` ne supporte pas les plages.

## 6. CSS Custom Properties (variables)

**Choix** : Thème via `--var()` CSS au lieu de classes multiples

**Raisons** :
- Un seul `.dark-theme` sur `<body>` bascule tout le thème
- Pas de duplication de styles
- Transition fluide entre modes (`transition: background-color 0.3s`)
- 24 variables couvrent couleurs, ombres, arrondis, largeur sidebar

## 7. Architecture IIFE + Namespace (pas ES Modules)

**Choix** : Pattern IIFE `(function(GearApp) { ... })(GearApp)` au lieu de `import/export`

**Raisons** :
- Les Web Workers ne supportent pas `import` sans build step (sauf avec `type: "module"` Worker, support limité)
- Compatibilité maximale avec tous les navigateurs
- `<script defer>` garantit l'ordre d'exécution
- Le namespace `GearApp` évite la pollution globale

**Shims** : Des ponts `window.*` sont maintenus pour les attributs `onclick` du HTML et la compatibilité avec les fichiers legacy.

## 8. Pub/Sub EventBus (pas Observer natif)

**Choix** : EventBus custom simple au lieu de `CustomEvent` sur le DOM

**Raisons** :
- Découple le moteur de recherche de l'UI sans dépendance DOM
- Plus léger qu'un event system complet
- 3 événements suffisent (`search:log`, `search:progress`, `solution:selected`)
- Pas besoin de bubbling/capturing

## 9. Types de transmission comme objets de configuration

**Choix** : Chaque type est un objet plat avec des méthodes (`calculerRapport`, `calculerRendement`, etc.) au lieu d'une hiérarchie de classes

**Raisons** :
- 7 types avec des interfaces similaires mais des formules différentes
- Un objet de configuration est plus lisible qu'une classe abstraite + 7 sous-classes
- Les méthodes sont courtes (3-10 lignes chacune)
- Le registre central (`TransmissionTypeRegistry`) encapsule l'accès

## 10. Formules d'ingénierie

### Rendement (formule de Merritt)
```
η = 1 - π·μ·(1/Z₁ + 1/Z₂) / cos(α)
```
Où μ = coefficient de frottement, Z = nombre de dents, α = angle de pression.

### Résistance des dents (Lewis)
```
σ = Ft / (b·m·Y)
Y = 0.154 - 0.912/Z
```
Où Ft = force tangentielle, b = largeur, m = module, Y = facteur de forme Lewis.

### Rapport de conduite
```
ε = (√(ra₁²-rb₁²) + √(ra₂²-rb₂²) - (r₁+r₂)·sin(α)) / (π·cos(α))
```
ε ≥ 1.2 recommandé pour un fonctionnement silencieux.

### Vis sans fin (rendement)
```
η = tan(λ) / tan(λ + φ)
```
Où λ = angle d'avance, φ = angle de frottement.

### Train épicycloïdal
```
Rapport = 1 + Z_couronne / Z_solaire
Contrainte : (Z_solaire + Z_couronne) % nb_satellites === 0
```

## 11. localStorage pour la persistance

**Choix** : `localStorage` pour sauvegarder les paramètres utilisateur

**Raisons** :
- Pas de backend nécessaire
- Persistance entre sessions
- API simple (`setItem`/`getItem`)
- Données non sensibles (paramètres de calcul uniquement)
