# Gear reduction calculator

Application d'ingénierie statique pour rechercher, comparer et visualiser des transmissions. **[Live demo](https://glloq.github.io/gears-reduction-calculator/)** — aucun backend et aucun build ne sont nécessaires.

## Features

- Recherche rapide par rapport ou solveur inverse par vitesse cible, jusqu'à huit étages, dans un Web Worker annulable.
- Modèle explicite des étages et registre extensible unique, partagé entre page, worker et tests.
- Modes minimum d'étages et exploration globale; contraintes d'encombrement et base d'un score multicritère explicable.
- Géométrie involute (diamètres primitif/base/tête/pied, pas, entraxe, déport, jeu et rapports de conduite), forces `Ft/Fr/Fa`, rendement, puissance et estimation thermique.
- Estimations **Lewis simplifié** et **Hertz simplifié**, matériaux et déclassement additif, fatigue et arbre. Ces résultats ne constituent pas une certification.
- Vues géométrique SVG, cinématique vectorielle multi-étages et linéaire Canvas sans relancer la recherche.
- Export SVG, PNG, JSON et CSV; comparaison et graphiques côté navigateur.
- Paramètres experts persistés dans `localStorage` et liens partageables compatibles avec les anciens paramètres.

## Supported transmissions

| Transmission | Ratio | Geometry | Mechanics | Kinematic | Optimization |
|---|---:|---:|---:|---:|---:|
| Spur / helical | ✓ | ✓ | estimate | ✓ | ✓ |
| Internal / bevel | ✓ | ✓ | estimate | ✓ | ✓ |
| Planetary (Willis) | ✓ | ✓ | estimate | ✓ | ✓ |
| Worm | ✓ | ✓ | estimate | ✓ | ✓ |
| Flat/V/round/timing belt | ✓ | ✓ | limited | ✓ | ✓ |
| Chain | ✓ | ✓ | limited | ✓ | ✓ |
| Rack and pinion | linear | ✓ | force | ✓ | API |

La formulation de Willis accepte les membres solaire `S`, couronne `R` et porte-satellites `C` comme entrée, sortie et élément fixe; elle valide aussi `Zr = Zs + 2 Zp` et la condition d'espacement des satellites. Les filets de vis (1–6) sont une variable indépendante des plages de dents.

## Calculation and optimization

Les unités internes sont mm, N, N·m, rpm, W, MPa et radians. Le calcul de force utilise explicitement `Ft = 2000 T / d_mm`. Le pipeline cible est : exigences → génération par le registre → géométrie → mécanique → contraintes → score → résultats. Les poids du score portent sur précision, taille, pertes, risque mécanique, étages, bruit, fabrication et coût; chaque métrique normalisée est conservée avec le score.

Les modules normalisés proposés sont destinés à guider le mode automatique; la validation finale d'un module dépend de la charge et des données de fabrication. Les règles de fabrication restent des recommandations configurables, notamment pour l'impression 3D.

## Kinematic diagrams

Le renderer vectoriel local reprend l'approche par primitives du dépôt `kinematic-gear-diagrams`; aucune ressource distante n'est chargée au runtime. `KinematicLayoutEngine` place automatiquement 1 à N étages. Les primitives distinguent droits, hélicoïdaux, internes, coniques, planétaires, vis, courroies, chaînes et crémaillères.

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

Sélection catalogue de roulements, modèle thermique avec température, ISO 6336 vérifiée avec données normatives, longueurs catalogue étendues, export DXF/OpenSCAD autonome et macros FreeCAD, ainsi que cycloïdal, strain-wave et planétaires composés. STEP/STL restent différés: une géométrie de fabrication fiable dans le navigateur exige davantage qu'une extrusion illustrative.
