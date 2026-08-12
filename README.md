# Gear reduction calculator

Application d'ingénierie statique pour rechercher, comparer et visualiser des transmissions. **[Live demo](https://glloq.github.io/gears-reduction-calculator/)** — aucun backend et aucun build ne sont nécessaires.

## Features

- Recherche rapide par rapport ou solveur inverse par vitesse cible, jusqu'à huit étages, dans un Web Worker annulable.
- Modèle explicite des étages et registre extensible unique, partagé entre page, worker et tests.
- Modes minimum d'étages et exploration globale; contraintes d'encombrement et base d'un score multicritère explicable.
- Géométrie involute (diamètres primitif/base/tête/pied, pas, entraxe, déport, jeu et rapports de conduite), forces `Ft/Fr/Fa`, rendement, puissance et estimation thermique.
- Estimations **Lewis simplifié** et **Hertz simplifié**, matériaux et déclassement additif. Les estimations facultatives de fatigue et d'arbre sont calculées par étage et ne constituent pas une certification.
- Vues géométrique SVG, cinématique vectorielle expérimentale et linéaire Canvas sans relancer la recherche.
- Export SVG, PNG, JSON et CSV; comparaison et graphiques de score, cascade, pertes et sécurité alimentés par le modèle `Solution`.
- Paramètres experts persistés dans `localStorage` et liens partageables compatibles avec les anciens paramètres.
- Progression détaillée avec branches évaluées, profondeur, rapport courant et causes de rejet.

## Supported transmissions

| Transmission | Ratio | Geometry | Forces | Bending | Contact | Manufacturing | Geometric view | Kinematic view |
|---|---|---|---|---|---|---|---|---|
| Spur | evaluated | evaluated | evaluated | evaluated | evaluated | partial | partial | evaluated |
| Helical | evaluated | evaluated | evaluated | evaluated | evaluated | partial | partial | evaluated |
| Internal | evaluated | evaluated | evaluated | evaluated | evaluated | partial | partial | evaluated |
| Bevel | evaluated | evaluated | evaluated | partial | partial | partial | partial | evaluated |
| Worm | evaluated | evaluated | evaluated | unsupported | unsupported | partial | partial | evaluated |
| Planetary (Willis) | evaluated | evaluated | partial | partial | partial | partial | partial | evaluated |
| Belt | evaluated | evaluated | unsupported | unsupported | unsupported | partial | partial | evaluated |
| Chain | evaluated | evaluated | unsupported | unsupported | unsupported | partial | unsupported | evaluated |
| Rack and pinion | evaluated | evaluated | evaluated | unsupported | unsupported | partial | partial | evaluated |

`partial` signifie qu'une méthode simplifiée ou une vue schématique est disponible avec des limites explicites. `unsupported` ne produit ni zéro fictif, ni `Infinity`, ni marge de sécurité implicite. Une contrainte SF/SH explicite rejette donc toute famille dont le contrôle correspondant n'est pas `evaluated`.

La formulation de Willis accepte les membres solaire `S`, couronne `R` et porte-satellites `C` comme entrée, sortie et élément fixe; elle valide aussi `Zr = Zs + 2 Zp` et la condition d'espacement des satellites. Les filets de vis (1–6) sont une variable indépendante des plages de dents.

## Calculation and optimization

Les unités internes sont mm, N, N·m, rpm, W, MPa et radians. Le calcul de force utilise explicitement `Ft = 2000 T / d_mm`. Le pipeline cible est : exigences → génération par le registre → géométrie → mécanique → contraintes → score → résultats. Les poids du score portent sur précision, taille, pertes, risque mécanique, étages, bruit, fabrication et coût; chaque métrique normalisée est conservée avec le score.

La recherche trie les candidats par proximité logarithmique avec la cible et applique avant la récursion des bornes de rapport minimal/maximal atteignable avec les étages restants. `maxIterations` compte les branches effectivement évaluées; les branches mathématiquement incapables d'atteindre la tolérance sont rejetées immédiatement et apparaissent dans les statistiques de rapport.

Le mode automatique essaie les modules normalisés par ordre croissant et conserve le premier qui respecte les contraintes simplifiées. Il ne fait pas varier un module d'engrenage pour les courroies ou les chaînes. Les règles `standard`, `CNC`, `laser`, `printing3d` et `custom` sont appliquées selon la famille et publient les règles appliquées, échecs et recommandations; elles restent des recommandations de pré-dimensionnement.

## Kinematic diagrams

Le renderer vectoriel local ne charge aucune ressource distante au runtime. Il possède des symboles distincts pour les transmissions et un modèle spatial d'arbres X/Y/Z partagé entre étages. Les relations parallèle, coaxiale, perpendiculaire et linéaire sont projetées en vues principale et orthogonale; sélection, zoom et déplacement restent disponibles. Ce schéma demeure une représentation cinématique et non une projection CAO.

## Architecture

- `js/transmissions/TransmissionRegistry.js`: source unique des contraintes, rapports, géométries, rendements, forces et candidats.
- `js/core/SearchEngine.js`: recherche pure utilisée par le worker et le fallback.
- `js/core/Engineering.js`: analyse, matériaux, fatigue, arbres, contraintes et scoring.
- `js/models/TransmissionTypeRegistry.js`: adaptateur de compatibilité pour l'ancienne UI, sans formule propre.
- `js/visualization/kinematic/`: layout et rendu, sans calcul mécanique.
- `js/ui/`: formulaire, résultats, comparaison et exports.

Tous les liens de production sont relatifs afin de fonctionner sous `/gears-reduction-calculator/`. Node sert seulement aux tests.

## Development and tests

```bash
npm test
npm run check:pages
python3 -m http.server 8000
```

Ouvrir ensuite `http://localhost:8000/` pour le développement local. La publication GitHub Pages utilise directement les fichiers statiques.

## Limitations and engineering disclaimer

Les modèles de résistance sont des **engineering estimates**: Lewis et Hertz simplifiés. L'analyse avancée est une structure inspirée de l'ISO (facteurs `KA`, `KV`, `KHα`, `KHβ`, `KFα`, `KFβ`, etc.), mais **n'est pas une implémentation ISO 6336 complète**. Les valeurs matériau sont indicatives; état métallurgique, lubrification, tolérances, température et anisotropie d'impression doivent être vérifiés. Fatigue, arbres, réactions de roulements et risque thermique sont des pré-dimensionnements, pas une validation de sécurité. Faites valider toute conception critique par un ingénieur qualifié.

## Roadmap

Priorités d'intégration restantes: tests navigateur avec un moteur graphique réel. Un test de fumée exécute déjà le script Worker de production, ses `importScripts` et les recherches rotative et linéaire dans un contexte Web Worker isolé. La crémaillère possède un solveur dédié et le layout maintient désormais des axes spatiaux partagés.

À plus long terme: sélection catalogue de roulements, modèle thermique avec température, ISO 6336 vérifiée avec données normatives, longueurs catalogue étendues, export DXF/OpenSCAD autonome et macros FreeCAD, ainsi que cycloïdal, strain-wave et planétaires composés. STEP/STL restent différés: une géométrie de fabrication fiable dans le navigateur exige davantage qu'une extrusion illustrative.
