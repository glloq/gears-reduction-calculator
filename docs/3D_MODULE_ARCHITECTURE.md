# Architecture du Module 3D - Calculateur d'Engrenages

## 1. Choix Technologiques

### 1.1 Stack retenue : Three.js + Manifold

| Composant | Librairie | Role | Taille |
|-----------|-----------|------|--------|
| Rendu 3D + Viewer | **Three.js** (CDN) | Scene, camera, OrbitControls, raycasting, materiaux | ~168 KB gz |
| CSG (booleans) | **Manifold** (manifold-3d WASM) | subtract/union pour engrenages interieurs, trous d'arbre | ~1-2 MB WASM |
| Export STL | **THREE.STLExporter** (addon) | Export mesh vers fichier STL binaire | ~5 KB |
| Export ZIP | **JSZip** (CDN) | Grouper N fichiers STL en un .zip | ~25 KB gz |
| Labels 2D | **CSS2DRenderer** (addon Three.js) | Tooltips, annotations dimensionnelles | inclus |

**Pourquoi ce choix :**
- Three.js est le standard WebGL, fonctionne en vanilla JS via CDN (pas de build step)
- Manifold est le seul a garantir des meshes manifold (etanches) apres operations booleennes
- Compatible avec l'architecture existante (IIFE, namespace GearApp, pas de bundler)
- STLExporter et CSS2DRenderer sont des addons officiels Three.js

**Alternative evaluee et ecartee :**
- Babylon.js : trop lourd (1.4 MB), pas d'avantage pour ce cas
- JSCAD : bon pour la geometrie mais viewer basique, pas de raycasting/selection
- Replicad/OpenCascade.js : trop lourd (2.4-7 MB WASM), necessite bundler

### 1.2 Chargement CDN

```html
<!-- Three.js core -->
<script src="https://cdn.jsdelivr.net/npm/three@0.170/build/three.min.js"></script>

<!-- Three.js addons (ES module ou UMD selon dispo) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.170/examples/jsm/controls/OrbitControls.js" type="module"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.170/examples/jsm/exporters/STLExporter.js" type="module"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.170/examples/jsm/renderers/CSS2DRenderer.js" type="module"></script>

<!-- Manifold WASM -->
<script src="https://cdn.jsdelivr.net/npm/manifold-3d@latest/manifold.js"></script>

<!-- JSZip -->
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10/dist/jszip.min.js"></script>
```

Note : Si les imports ES module posent probleme en vanilla JS, utiliser un shim import-map ou charger via des UMD builds.

---

## 2. Architecture Fichiers

```
js/
  visualization/
    Gear3DViewer.js        # Scene Three.js, camera, controles, renderer
    Gear3DGeometry.js      # Generation geometrie 3D pour chaque type
    Gear3DAssembly.js      # Positionnement, arbres, roulements, assemblage
    Gear3DInteraction.js   # Selection, hover, tooltips, edition
    Gear3DExporter.js      # Export STL/ZIP
    Gear3DAnimation.js     # Animation rotation synchronisee
    Gear3DPrintAdapter.js  # Tolerances impression 3D, overhang, verification
    InvoluteProfile.js     # Profil developpante 2D (partage avec GearSVG)
    GT2Profile.js          # Profil dent GT2/HTD pour poulies crantees
```

### 2.1 Integration dans le namespace

```javascript
GearApp.visualization.Gear3DViewer = Gear3DViewer;
GearApp.visualization.Gear3DGeometry = Gear3DGeometry;
// etc.
```

### 2.2 Connexion a l'existant

```
UIController._onSolutionSelected(index, solution)
  |
  +-- _drawSVGSchematic(solution)     // existant
  +-- _draw3DSchematic(solution)      // NOUVEAU
  |     |
  |     +-- Gear3DGeometry.createGearMesh(type, A, B, mod, params)
  |     +-- Gear3DAssembly.buildTrain(solution, params)
  |     +-- Gear3DViewer.displayAssembly(assembly)
  |
  +-- mechanicalPanel.show(...)       // existant
```

Le bouton "3D" dans le HTML active/desactive la vue 3D. La vue SVG reste disponible.

---

## 3. Generation Geometrique par Type

### 3.1 Profil Developpante 2D (Commun)

Module `InvoluteProfile.js` - genere le contour 2D d'un engrenage :

**Parametres d'entree :** Z (nb dents), m (module), alpha (angle de pression, defaut 20deg)

**Calculs cles :**
- Rayon primitif : `rPitch = m * Z / 2`
- Rayon de base : `rBase = rPitch * cos(alpha)`
- Rayon de tete : `rTip = rPitch + m`
- Rayon de pied : `rRoot = rPitch - 1.25 * m`
- Epaisseur de dent au primitif : `s = PI * m / 2`
- Pas angulaire : `2 * PI / Z`

**Courbe developpante (parametrique) :**
```
x(t) = rBase * (cos(t) + t * sin(t))
y(t) = rBase * (sin(t) - t * cos(t))
```
ou t va de 0 a tMax = sqrt((rTip/rBase)^2 - 1)

**Discretisation : ~30 points/dent** pour un bon compromis qualite/performance.

**Structure du profil retourne :** Array de {x, y} formant un polygone ferme (toutes les dents).

Note : `GearMechanics.genererProfilDeveloppante()` existe deja (ligne 187-203) et peut etre reutilise/enrichi.

### 3.2 Spur (Engrenage droit) - Extrusion lineaire

| Etape | Methode |
|-------|---------|
| Profil 2D | InvoluteProfile.generate(Z, m, alpha) |
| 3D | `THREE.ExtrudeGeometry(shape, {depth: largeur, steps: 1})` |
| Trou d'arbre | Manifold.subtract(cylindre central) |

Complexite : **Faible**

### 3.3 Helical (Helicoidal) - Extrusion avec twist

| Etape | Methode |
|-------|---------|
| Profil 2D | InvoluteProfile.generate(Z, m, alpha) |
| 3D | `ExtrudeGeometry(shape, {depth: largeur, steps: 16-32})` puis post-twist des vertices |
| Twist | Pour chaque vertex a profondeur z : rotation de `z * tan(beta) / rPitch` |

Post-traitement des vertices :
```javascript
for (let i = 0; i < positions.count; i++) {
  const z = positions.getZ(i);
  const angle = z * Math.tan(beta) / rPitch;
  const x = positions.getX(i), y = positions.getY(i);
  positions.setXY(i, x*cos(angle) - y*sin(angle), x*sin(angle) + y*cos(angle));
}
geometry.computeVertexNormals();
```

Complexite : **Moyenne**

### 3.4 Internal (Interieur) - Profil inverse ou CSG

**Approche recommandee : profil direct (sans CSG)**
- Profil interne = dents vers l'interieur
- `rTip_internal = rPitch - m` (tete vers le centre)
- `rRoot_internal = rPitch + 1.25 * m` (pied vers l'exterieur)
- Corps annulaire de `rRoot_internal` a `rOuter = rRoot_internal + 3*m`

**Approche alternative (CSG) si profil direct complexe :**
1. Creer anneau (cylindre ext - cylindre int)
2. Creer engrenage externe au diametre interieur
3. Manifold.subtract(anneau, engrenage)

Complexite : **Moyenne**

### 3.5 Bevel (Conique) - Profil sur cone

**Methode : Approximation de Tredgold**
1. Angle de cone : `delta = atan(Z1/Z2)` (pour angle arbre 90deg)
2. Rayon du cone arriere : `rBack = rPitch / cos(delta)`
3. Nb dents virtuel : `Zv = Z / cos(delta)`
4. Generer profil 2D avec Zv dents
5. Creer N tranches (8-16) du grand bout au petit bout
6. Chaque tranche est le meme profil mis a l'echelle lineairement
7. Les tranches suivent la surface du cone

Construction : `BufferGeometry` procedurale (pas d'ExtrudeGeometry).

Complexite : **Elevee**

### 3.6 Belt (Courroie) - Revolution + bande

**3 sous-types de poulie :**

#### 3.6.1 Poulie V (gorge trapezoïdale)
- Profil en coupe : trapeze standard (34-38deg selon section)
- `THREE.LatheGeometry(profilCoupe, segments=48)`

#### 3.6.2 Poulie plate
- Profil en coupe : cylindre avec rebords lateraux
- `THREE.LatheGeometry(profilCoupe, segments=48)`

#### 3.6.3 Poulie crantee GT2 (et variantes)

Profil de dent GT2 (pas 2mm) - specifique impression 3D :

| Parametre | GT2 (2mm) | GT2.5 (2.5mm) | GT3 (3mm) | Personnalise |
|-----------|-----------|---------------|-----------|-------------|
| Pas (pitch) | 2.0 mm | 2.5 mm | 3.0 mm | parametrique |
| Hauteur dent | 0.75 mm | 1.0 mm | 1.14 mm | ~0.375 * pas |
| Largeur fond | 0.555 mm | 0.7 mm | 0.83 mm | ~0.277 * pas |
| Rayon fond | 0.555 mm | 0.69 mm | 0.83 mm | ~0.277 * pas |
| Rayon flanc | 1.0 mm | 1.25 mm | 1.52 mm | ~0.5 * pas |

**Profil GT2 (coupe d'une dent) :**
Le profil GT2 est **curviligne** (pas trapezoidal) : deux arcs de cercle tangents.

```
Procedure pour une dent GT2 :
1. Centre du fond de dent a y = 0 (rayon interieur de la poulie)
2. Arc de fond : rayon = r_fond, de -theta_fond a +theta_fond
3. Arc de flanc : rayon = r_flanc, tangent a l'arc de fond
4. Sommet de dent : ligne droite reliant les deux flancs (land)
5. Repeter autour de la poulie pour Z dents
```

- Nombre de dents poulie : `Z = floor(PI * diamPrimitive / pas)`
- Diametre primitif poulie : determine par le calcul existant (valeur A ou B en mm)
- Diametre exterieur : `dExt = dPrimitif + 2 * hDent`

**Construction 3D :**
1. Generer le profil radial d'une dent GT2 (polyline de ~12-16 points)
2. Repeter Z fois autour du cercle -> profil 2D complet
3. `THREE.ExtrudeGeometry(shape, {depth: largeurCourroie})` pour la poulie
4. Optionnel : rebords (flanges) de chaque cote

**Courroie crantee :**
- Section rectangulaire avec dents sur la face interieure
- Le mesh courroie est un tube extrude le long du path poulie-A -> tangente -> poulie-B -> tangente
- Les dents cote interieur sont des bosses periodiques (pas = GT2 pitch)
- Simplification acceptable : texture normal-map pour simuler les dents sur la courroie

**Courroie lisse (V, plate, ronde) :**
- Calculer les tangentes entre les deux poulies (entraxe, diametres)
- Tracer le chemin : arc sur poulie A + tangente + arc sur poulie B + tangente
- Extruder une section rectangulaire/trapezo/circulaire le long de ce chemin
- Materiau caoutchouc : `MeshStandardMaterial({color: 0x222222, roughness: 0.9})`

**Selection du type dans le formulaire :**
Le parametre `typeCourroie` existant dans TransmissionTypeRegistry supporte deja :
`['Plate', 'V', 'Crantée', 'Ronde']`. On enrichit `'Crantée'` avec un sous-parametre
`profilCrantee` : `['GT2', 'GT2.5', 'GT3', 'HTD-3M', 'HTD-5M', 'Personnalise']`.

Complexite : **Moyenne** (a cause du profil GT2 curviligne)

### 3.7 Epicyclic (Epicycloidal) - Assemblage multi-composants

| Composant | Geometrie | Positionnement |
|-----------|-----------|----------------|
| Solaire | Spur gear (Z_sun) | Origine, axe Z |
| Satellites (x N) | Spur gear (Z_planet) | `rCarrier * [cos(i*2PI/N), sin(i*2PI/N)]`, axe Z |
| Couronne | Internal gear (Z_ring) | Origine, axe Z (concentrique solaire) |
| Porte-satellites | Disque + axes | Origine, axe Z |

- Z_planet = (Z_ring - Z_sun) / 2
- rCarrier = m * (Z_sun + Z_planet) / 2
- Condition assemblage : `(Z_sun + Z_ring) % N === 0`
- **InstancedMesh** pour les satellites (meme geometrie, N transforms)

Complexite : **Moyenne** (assemblage, pas geometrie individuelle)

### 3.8 Worm (Vis sans fin) - Helicoid + roue modifiee

**Vis (worm) :**
- Surface helicoidale parametrique :
```
x(u,v) = (rBase + u*cos(alpha)) * cos(v)
y(u,v) = (rBase + u*cos(alpha)) * sin(v)
z(u,v) = u*sin(alpha) + (lead/(2*PI)) * v
```
- `rBase = q * m / 2` (q=10, quotient diametre)
- `lead = A * PI * m`
- `THREE.ParametricGeometry` ou BufferGeometry procedurale
- Subdivision : 32-64 en u et v

**Roue vis sans fin :**
- Simplification : engrenage droit avec Z_wheel dents
- Face concave (gorge) : decouper les tranches selon `rThroat(x) = sqrt(rWormOuter^2 - x^2)`

**Impression 3D :** Voir section 12.2 pour les strategies d'impression specifiques
(orientation verticale recommandee, chanfrein sous-filet, segmentation optionnelle).

Complexite : **Elevee**

---

## 4. Assemblage et Positionnement

### 4.1 Structure de Donnees : GearTrainAssembly

```javascript
{
  stages: [
    {
      index: 0,
      typeId: 'spur',
      gearA: { mesh, Z, m, position, axis, shaftId },
      gearB: { mesh, Z, m, position, axis, shaftId },
      meshPoint: { position, lineOfAction },
      connector: null  // ou belt mesh pour type belt
    },
    // ...
  ],
  shafts: [
    { id: 0, axis: [0,0,1], position: [0,0,0], gears: [ref, ref], isFixed: false },
    { id: 1, axis: [0,0,1], position: [C,0,0], gears: [ref, ref], isFixed: false },
  ],
  constraints: [
    { type: 'coaxial', shaft1: 0, shaft2: 0, gears: [stageA.gearB, stageB.gearA] },
    { type: 'meshing', gear1: ref, gear2: ref },
    { type: 'fixed_frame', shaft: 2 }
  ]
}
```

### 4.2 Entraxe et positionnement par type

| Type | Entraxe theorique | Axes |
|------|-------------------|------|
| spur | `m*(Z1+Z2)/2` | paralleles, Z |
| helical | `mn*(Z1+Z2)/(2*cos(beta))` | paralleles, Z |
| internal | `m*(Z2-Z1)/2` | paralleles, Z |
| bevel | Cone distance = `m*Z1/(2*sin(delta))` | 90deg (Z et X) |
| belt | Libre (defaut: `(D1+D2)*2`) | paralleles, Z |
| epicyclic | Sun-planet: `m*(Zs+Zp)/2` | coaxiaux, Z |
| worm | `(q*m + m*Zw)/2` | 90deg offset (Z et Y) |

### 4.3 Offset d'entraxe (tolerance impression 3D)

**Probleme :** En impression 3D (FDM/SLA), les dimensions reelles different des dimensions theoriques
a cause des tolerances de fabrication. Pour que les engrenages tournent librement, il faut
augmenter l'entraxe d'un offset.

**Parametre global :** `offsetEntraxe` (defaut 0, typique 0.2-0.5mm pour FDM)

**Application de l'offset :**

```javascript
// Entraxe effectif = entraxe theorique + offset
var entraxeEffectif = entraxeTheorique + params.offsetEntraxe;
```

L'offset s'applique a TOUS les types sauf epicyclic (ou il faut l'appliquer 2 fois :
sun-planet et planet-ring). Tableau des effets :

| Type | Entraxe effectif | Notes |
|------|-----------------|-------|
| spur | `m*(Z1+Z2)/2 + offset` | Offset positif = jeu supplementaire |
| helical | `mn*(Z1+Z2)/(2*cos(beta)) + offset` | Idem |
| internal | `m*(Z2-Z1)/2 + offset` | Offset positif = pignon plus excentre |
| bevel | Cone distance + `offset` (sur la distance de montage) | Effet sur le jeu de flanc conique |
| belt | Entraxe + `offset` | Tension de courroie legerement augmentee |
| epicyclic | Sun-planet: `C_sp + offset`, Ring interieur: `rRing - offset` (double application) | Plus complexe |
| worm | `(q*m + m*Zw)/2 + offset` | Offset critique pour le frottement |

**UI :** Slider dans le panneau export/impression 3D :
- Label : "Offset entraxe (tolerance fabrication)"
- Plage : 0 a 1.0 mm, step 0.05 mm
- Presets : FDM standard (0.3mm), FDM precis (0.15mm), SLA (0.1mm), usinage (0.05mm)
- L'offset est applique a la generation 3D et a l'export STL, PAS a la vue visualisation pure
  (option toggle : "Appliquer tolerances" pour basculer entre vue theorique et vue impression)

**Impact sur le profil :** L'offset d'entraxe ne modifie pas la geometrie des dents.
Il modifie uniquement la distance entre les centres de rotation.
Pour un jeu supplementaire entre dents, voir le jeu de denture (backlash) existant
dans `GearMechanics.calculerJeuDenture()`.

### 4.4 Arbre entre etages (compound gear)

Quand le gearB de l'etage N et le gearA de l'etage N+1 partagent le meme arbre :
- Meme position 3D
- Meme axe de rotation
- Rotation synchronisee (vitesse identique)
- Visualise par un cylindre d'arbre traversant les deux engrenages

---

## 5. Systeme d'Interaction

### 5.1 Indicateurs visuels de contraintes

| Contrainte | Visuel 3D |
|------------|-----------|
| Arbre partage (compound) | Cylindre metallique gris reliant les engrenages + collier colore par arbre |
| Engrenement (meshing) | Ligne pointillee centre-a-centre + icone mesh au point de tangence |
| Fixe (housing/frame) | Symbole sol (triangle hachure) a la base + materiau mat |
| Libre en rotation | Anneau de roulement (tore bronze) autour de l'arbre |
| Courroie | Bande noire extrudee entre poulies + scroll texture en animation |
| Fleche sens rotation | Arc fleche sur la face de l'engrenage (Sprite billboard) |

### 5.2 Selection et surbrillance

- **Clic** : Raycaster -> selection engrenage individuel -> OutlinePass (contour colore)
- **Double-clic** : Selection etage complet (les 2 engrenages + arbre)
- **Survol** : Emissive boost + tooltip HTML (CSS2DRenderer) avec infos : type, Z, m, diametre, vitesse
- **Ctrl+clic** : Multi-selection pour comparaison
- **Clic zone vide** : Deselection

### 5.3 Edition interactive

Mode toolbar : **[Selectionner] [Ajouter etage] [Supprimer] [Inspecter]**

**Ajouter etage :**
1. L'arbre de sortie du dernier etage s'illumine
2. Un panneau mini-formulaire apparait : type, Z_A, Z_B, module
3. Preview fantome (semi-transparent) en temps reel
4. Confirmation -> solidification + animation d'insertion

**Modifier parametres :**
- Panneau proprietes a droite quand un engrenage est selectionne
- Sliders pour Z, m, largeur avec regeneration 3D en temps reel (debounce 100ms)

**Undo/Redo (Command Pattern) :**
- Chaque action = objet avec `execute()` et `undo()`
- Pile undo/redo, Ctrl+Z / Ctrl+Shift+Z
- Types : AddStageCmd, RemoveStageCmd, ChangeParamCmd

### 5.4 Manipulation angulaire (bevel/worm)

- TransformControls en mode rotation sur l'arbre concerne
- Snap a 15deg/45deg/90deg
- Arc visuel montrant l'angle entre les axes
- Contrainte : un seul axe de rotation autorise (desactiver les 2 autres)

---

## 6. Controles de Vue

### 6.1 Navigation standard

- **OrbitControls** : clic-gauche orbite, clic-droit pan, molette zoom
- **Damping** : `enableDamping = true, dampingFactor = 0.05`
- **Limites** : minDistance/maxDistance pour eviter de rentrer dans les engrenages

### 6.2 Vues predefines

Boutons toolbar : **Face | Dessus | Droite | Isometrique**
- Animation fluide camera (300-500ms) vers la position cible
- Optionnel : ViewCube dans le coin (three-viewcube)

### 6.3 Fonctions speciales

| Fonction | Implementation |
|----------|---------------|
| Zoom tout | `Box3.setFromObject()` -> camera distance calculee |
| Vue en coupe | `THREE.Plane` + clipping + stencil pour caps |
| Vue eclatee | Translation animee par composant (radiale/axiale) + lignes pointillees |

---

## 7. Animation

### 7.1 Rotation synchronisee

Meme logique que l'animation SVG existante (`GearSVG._stageRatio()`) :

```javascript
// Vitesse angulaire par engrenage
omega[0] = baseSpeed;  // entree
for (stage of stages) {
  const ratio = stageRatio(stage);  // B/A ou 1+B/A pour epicyclic
  const direction = stageDirection(stage);  // -1 ou +1
  omega[next] = omega[current] / ratio * direction;
}

// Dans le render loop
gear.rotation.z += omega[i] * deltaTime;
```

### 7.2 Particularites par type

| Type | Rotation gearA | Rotation gearB |
|------|---------------|----------------|
| spur | +omega | -omega * Z_A/Z_B (sens inverse) |
| helical | +omega | -omega * Z_A/Z_B |
| internal | +omega | +omega * Z_A/Z_B (meme sens) |
| bevel | +omega (axe Z) | -omega * Z_A/Z_B (axe X, 90deg) |
| belt | +omega | +omega * D_A/D_B (meme sens) ou inverse si croisee |
| epicyclic | solaire: +omega, satellites: orbitent + tournent, couronne: fixe |
| worm | vis: +omega (axe Z), roue: omega*A/B (axe Y) |

---

## 8. Export STL

### 8.1 Pipeline

```
1. Selection des engrenages a exporter (tous ou selection)
2. Pour chaque engrenage selectionne :
   a. Recuperer le mesh Three.js
   b. Appliquer les transformations mondiales (position, rotation, scale)
   c. THREE.STLExporter.parse(mesh, {binary: true})
   d. Nommer : "etage{N}_{typeId}_{role}.stl" (ex: "etage1_spur_menante.stl")
3. Si multiple fichiers : JSZip.generateAsync({type: 'blob'})
4. Telecharger via URL.createObjectURL() + <a>.click()
```

### 8.2 Options export

- Fichier unique (assemblage complet) ou fichiers separes par engrenage
- Echelle : 1:1 en mm (compatible impression 3D directe)
- Inclusion optionnelle des arbres et porte-satellites
- **Mode impression 3D :** Applique automatiquement les tolerances (offset entraxe,
  jeu de dent, chanfreins, trous d'arbre) selon les parametres de la section 12
- Verification d'imprimabilite avant export (avertissements overhang, epaisseur min, etc.)
- **Fichier README.txt** inclus dans le ZIP : parametres utilises, avertissements, conseils d'impression

---

## 9. Plan d'Implementation par Phases

### Phase 1 : Fondations (vue 3D basique)

**Fichiers :** `Gear3DViewer.js`, `InvoluteProfile.js`, `Gear3DGeometry.js` (spur uniquement)

1. Scene Three.js avec OrbitControls dans un nouveau container `#viewer3D`
2. Generation du profil developpante 2D
3. ExtrudeGeometry pour engrenages droits
4. Affichage d'un train spur basique (positionnement par entraxe)
5. Bouton toggle 2D/3D dans le HTML

**Livrable :** Un engrenage droit en 3D avec zoom/orbite quand on selectionne un resultat.

### Phase 2 : Tous les types + assemblage

**Fichiers :** `Gear3DGeometry.js` (complet), `Gear3DAssembly.js`

1. Helical : twist des vertices
2. Internal : profil inverse + anneau
3. Bevel : tranches coniques (BufferGeometry)
4. Belt : LatheGeometry pour poulies + bande extrudee
5. Epicyclic : assemblage solaire/satellites/couronne/porte-satellites
6. Worm : ParametricGeometry helicoidale

**Livrable :** Tous les types de transmission en 3D, positionnement correct entre etages.

### Phase 3 : Interaction + visuels

**Fichiers :** `Gear3DInteraction.js`, `Gear3DAnimation.js`

1. Selection par raycasting + OutlinePass
2. Tooltips HTML (CSS2DRenderer)
3. Animation rotation synchronisee
4. Indicateurs visuels : arbres, roulements, fleches sens rotation
5. Vues predefines (face, dessus, isometrique)

**Livrable :** Vue 3D interactive complete avec animation et infos par engrenage.

### Phase 4 : Export + impression 3D + edition

**Fichiers :** `Gear3DExporter.js`, `Gear3DPrintAdapter.js`, `GT2Profile.js`, modifications `Gear3DInteraction.js`

1. Export STL individuel et groupe (ZIP)
2. `Gear3DPrintAdapter` : offset entraxe, jeu dent, tolerances, presets imprimante
3. Verification d'imprimabilite (overhang, epaisseur min, module min)
4. Strategies vis sans fin (orientation verticale, chanfrein sous-filet, segmentation)
5. `GT2Profile` : profil poulie crantee GT2/GT2.5/GT3/HTD
6. Trous d'arbre parametriques (rond, D-cut, hexagonal, carre)
7. Edition : ajout/suppression etage en 3D
8. Modification parametres avec preview en temps reel
9. Undo/redo (Command Pattern)
10. Vue en coupe + vue eclatee (epicyclic)

**Livrable :** Module 3D complet avec export, reglages impression 3D et edition.

---

## 10. Integration HTML

```html
<!-- Nouveau conteneur 3D (apres svgContainer) -->
<div class="viz-section" id="viz3DSection" style="display:none;">
  <div class="viz-header">
    <h2>Vue 3D interactive</h2>
    <div class="viz-controls">
      <button onclick="UI.toggle3DAnimation()" class="btn-small">Animer</button>
      <button onclick="UI.reset3DView()" class="btn-small">Recentrer</button>
      <button onclick="UI.preset3DView('iso')" class="btn-small">Iso</button>
      <button onclick="UI.preset3DView('face')" class="btn-small">Face</button>
      <button onclick="UI.preset3DView('dessus')" class="btn-small">Dessus</button>
      <button onclick="UI.exportSTL()" class="btn-small">STL</button>
      <button onclick="UI.exportAllSTL()" class="btn-small">ZIP STL</button>
    </div>
  </div>
  <div id="viewer3D" class="viewer-3d-container"></div>
  <p class="viz-hint">Orbite: clic-glisser | Pan: clic-droit | Zoom: molette | Clic: selectionner</p>
</div>

<!-- Toggle 2D/3D -->
<div class="viz-toggle">
  <button onclick="UI.showView('svg')" class="btn-small active">2D SVG</button>
  <button onclick="UI.showView('3d')" class="btn-small">3D</button>
</div>
```

### Scripts supplementaires dans index.html

```html
<!-- Three.js + addons -->
<script src="https://cdn.jsdelivr.net/npm/three@0.170/build/three.min.js"></script>
<!-- ... addons charges en ES module ou shim -->

<!-- Manifold (charge async) -->
<script src="https://cdn.jsdelivr.net/npm/manifold-3d@latest/manifold.js"></script>

<!-- JSZip -->
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10/dist/jszip.min.js"></script>

<!-- Module 3D -->
<script src="js/visualization/InvoluteProfile.js" defer></script>
<script src="js/visualization/Gear3DGeometry.js" defer></script>
<script src="js/visualization/Gear3DAssembly.js" defer></script>
<script src="js/visualization/Gear3DViewer.js" defer></script>
<script src="js/visualization/Gear3DInteraction.js" defer></script>
<script src="js/visualization/Gear3DAnimation.js" defer></script>
<script src="js/visualization/Gear3DExporter.js" defer></script>
```

---

## 11. Estimation de Complexite

| Composant | Complexite | Raison |
|-----------|-----------|--------|
| InvoluteProfile.js | Faible | Maths connues, code existant dans GearMechanics |
| GT2Profile.js | Moyenne | Profil curviligne (arcs tangents), multi-standards |
| Spur 3D | Faible | ExtrudeGeometry simple |
| Helical 3D | Moyenne | Post-twist des vertices |
| Internal 3D | Moyenne | Profil inverse ou CSG |
| Bevel 3D | Elevee | BufferGeometry procedurale, geometrie conique |
| Belt 3D (V/plate) | Faible | LatheGeometry + bande simple |
| Belt 3D (GT2 crantee) | Moyenne | Profil GT2 + dents sur poulie |
| Epicyclic 3D | Moyenne | Assemblage multi-composants, InstancedMesh |
| Worm 3D | Elevee | Surface helicoidale parametrique |
| Viewer + controles | Faible | Three.js boilerplate standard |
| Selection + tooltips | Moyenne | Raycasting + CSS2DRenderer |
| Animation | Moyenne | Synchronisation multi-type |
| Export STL | Faible | STLExporter + JSZip |
| Gear3DPrintAdapter | Moyenne | Tolerances, overhang check, presets, CSG trous |
| Worm print strategies | Elevee | Chanfrein sous-filet, segmentation, verification angles |
| Edition interactive | Elevee | Command pattern, UI, live preview |

---

## 12. Compatibilite Impression 3D

L'un des objectifs principaux de l'export STL est l'impression 3D. Chaque type
d'engrenage pose des defis specifiques lies aux limites physiques de l'impression
(FDM principalement, mais aussi SLA/SLS).

### 12.1 Contrainte d'overhang (angle dans le vide)

**Regle :** En FDM, toute surface dont l'angle par rapport a l'horizontale est
inferieur a un seuil necessite du support d'impression (ou echoue).

**Parametre global :** `angleOverhangMax` (defaut 45deg, parametrique de 30 a 60deg)

```javascript
var printParams = {
  angleOverhangMax: 45,      // degres, par defaut
  offsetEntraxe: 0.3,        // mm, tolerance fabrication
  jeuRadialDent: 0.1,        // mm, jeu supplementaire sur profil dent
  epaisseurParoiMin: 1.2,    // mm, minimum pour solidite
  orientationImpression: 'auto'  // 'auto', 'axeZ', 'axeX', 'couche'
};
```

**Impact par type de geometrie :**

#### Engrenages cylindriques (spur, helical, internal)

**Impression optimale : axe de l'engrenage = axe Z imprimante (a plat)**

- Les dents sont verticales -> pas de probleme d'overhang sur les flancs
- La face de tete est horizontale -> OK
- Le creux entre dents (dedendum) forme un "canyon" vertical -> OK

**Probleme :** Les conges de raccordement au pied de dent (root fillet) ont un
rayon de ~0.3*m. Si le module est petit (<1mm), le fillet peut etre en dessous
de la resolution imprimante. Solution : augmenter le rayon de fillet a
`max(0.3*m, 0.5mm)` en mode impression.

#### Engrenage helicoidal

**Probleme specifique :** La face de dent helicoidale est inclinee par rapport a
l'axe. Si l'angle d'helice `beta` est trop grand, la face superieure de la dent
depasse l'angle d'overhang.

**Contrainte :**
```
beta_max = 90 - angleOverhangMax
```
Avec overhang 45deg : `beta_max = 45deg` -> compatible avec les helicoidaux standards (15-30deg).
Avec overhang 30deg : `beta_max = 60deg` -> toujours OK.

**Action :** Afficher un avertissement si `beta > beta_max`. Ne pas bloquer mais
indiquer que du support sera necessaire.

#### Engrenage interieur (couronne)

**Probleme :** Les dents internes sont en surplomb si l'anneau est imprime a plat.
En realite, imprime axe Z = vertical, les dents internes sont identiques aux
dents externes (verticales) -> **pas de probleme d'overhang**.

**Probleme reel :** Si la couronne est large (grande largeur de dent), le pont
superieur de l'anneau (entre le diametre exterieur et le sommet des dents
interieures) peut etre un overhang. Solution : imprimer le pont en mode
"bridge" (la plupart des slicers le gerent) ou ajouter des nervures internes.

#### Engrenage conique (bevel)

**Probleme majeur :** L'angle du cone fait que les dents sont inclinees par
rapport a la verticale. Pour un angle de cone `delta` :

```
angle_dent_vs_horizontal = 90 - delta
```

Si `delta > angleOverhangMax` -> la face exterieure du cone necessite du support.

**Solutions :**
1. **Orientation optimale :** Imprimer le bevel avec l'axe du cone a 45deg
   (compromis entre les deux faces)
2. **Separation en deux pieces :** Couper le bevel en deux au plan de symetrie
   et imprimer chaque moitie a plat (assemblage par collage/vis)
3. **Support integre :** Ajouter des supports detachables dans le STL

**Action :** Ajouter une option `bevelPrintMode` : `'monobloc'` (defaut) ou
`'split'` (coupe en deux avec locators d'alignement).

#### Poulie (belt)

Imprimee axe vertical -> cylindre de revolution, pas de probleme d'overhang.
Les gorges V ou GT2 sont verticales.

**Exception :** Les rebords (flanges) de la poulie sont horizontaux et en
surplomb si leur epaisseur est significative. Solution : chanfreiner le dessous
du rebord a `angleOverhangMax`.

#### Train epicycloidal

Chaque composant est un cylindre imprime separement -> memes regles que spur/internal.
Le porte-satellites est un disque avec trous -> imprimer a plat, les trous sont
verticaux, pas de probleme.

**Point d'attention :** Les axes des satellites (pins) sont des petits cylindres
fins. Si diametre < 3mm, ils seront fragiles. Prevoir un diametre min parametrique :
`diamAxeSatelliteMin = max(m * 2, 3.0)` mm.

#### Vis sans fin - voir section 12.2 detaillee

### 12.2 Vis sans fin : conception specifique impression 3D

La vis sans fin est le type le plus problematique pour l'impression 3D car le
filet helicoidal cree des overhangs systematiques.

#### 12.2.1 Analyse du probleme

Le filet de la vis est une surface helicoidale. A chaque point, l'angle de la
surface par rapport a l'horizontale depend de :

- **L'angle d'avance** `lambda = atan(A/q)` ou A = nb filets, q = quotient diametre
- **L'angle de pression** `alpha` (typiquement 20deg)
- **La position sur le filet** (dessus vs flanc vs dessous)

**Face superieure du filet :**
L'angle par rapport a l'horizontale = `lambda` (angle d'avance).

Pour les vis sans fin classiques :
- 1 filet, q=10 : `lambda = atan(1/10) = 5.7deg` -> **TRES a plat** -> probleme majeur
- 2 filets, q=10 : `lambda = atan(2/10) = 11.3deg` -> encore trop plat
- 4 filets, q=10 : `lambda = atan(4/10) = 21.8deg` -> encore insuffisant pour 45deg
- 6 filets, q=10 : `lambda = atan(6/10) = 31.0deg` -> limite basse

**Conclusion :** Avec les vis standard (1-4 filets), l'impression FDM **axe horizontal**
est tres difficile sans support.

#### 12.2.2 Strategies d'impression pour la vis

**Strategie A : Impression axe vertical (RECOMMANDEE)**

Imprimer la vis avec son axe vertical (axe Z de l'imprimante).

- Le filet helicoidal monte en spirale
- A chaque couche, la section circulaire change legerement
- Les surfaces du filet forment un angle = `90 - lambda` par rapport a l'horizontale
- Pour 1 filet : `90 - 5.7 = 84.3deg` -> **largement au-dessus de 45deg** -> OK!

**Probleme :** La face inferieure du filet (undercut) est un overhang.
- Angle du dessous = `lambda` par rapport a l'horizontale
- Pour 1 filet : 5.7deg -> quasi horizontal -> BRIDGE necessaire
- Les slicers modernes gerent ce type de bridge helicoidal car chaque couche
  a un petit decalage (pas un vrai pont libre)

**Parametres adaptes :**
```javascript
wormPrintParams = {
  orientation: 'vertical',          // axe de la vis = Z imprimante
  remplissageFilet: 100,            // % (plein pour la resistance)
  supportInterne: false,            // pas necessaire en vertical
  pasMinCouche: 0.1,               // mm, couche fine pour finition filet
  // Modification geometrique optionnelle :
  chanfreinSousFilet: true,         // ajouter chanfrein 45deg sous le filet
  angleChanfrein: 'auto'            // = angleOverhangMax
}
```

**Strategie B : Filet modifie pour impression horizontale**

Si l'impression verticale n'est pas souhaitee (vis tres longue par ex.) :

1. **Modifier le profil du filet** : remplacer le fond plat du filet par un
   profil a 45deg minimum.
   - Le creux trapézoïdal standard (angle de pression 20deg) est remplace par
     un profil dont l'angle minimal = `angleOverhangMax`
   - Cela reduit la profondeur utile du filet mais rend l'impression possible

2. **Augmenter q (quotient diametre)** : Un q plus grand = vis plus epaisse
   relative a ses filets = angle d'avance plus faible = filet moins pentu.
   Mais n'aide PAS pour l'overhang du dessous du filet.

3. **Segmentation :** Couper la vis en troncons courts imprimes verticalement
   puis assembles (vis M3 dans l'axe pour aligner).

**Strategie C : Support soluble (double extrusion)**

Pour les imprimantes FDM double extrusion (PVA/HIPS) :
- Imprimer la vis horizontalement avec support soluble
- Post-traitement : dissolution dans l'eau (PVA) ou limonene (HIPS)
- Meilleure finition de surface pour le filet

#### 12.2.3 Roue vis sans fin (worm wheel)

La roue est un engrenage avec gorge concave (throat).

**Impression :** Axe vertical -> les dents sont verticales, pas de probleme.
La gorge concave est un creux horizontal (bridge) que les slicers gerent bien
car le rayon est generalement > 5mm.

**Modification pour impression :** Renforcer la base des dents avec un
rayon de conge plus genereux : `filletRadius = max(0.4 * m, 0.8)` mm.

#### 12.2.4 Parametres UI pour vis sans fin impression 3D

```
Panneau "Options Impression 3D - Vis sans fin" :
[x] Optimiser pour impression 3D
    Orientation vis : [Verticale (recommande)] [Horizontale + support]
    [ ] Ajouter chanfrein sous-filet (45deg)
    [ ] Segmenter la vis (longueur segment : [20] mm)
    [ ] Ajouter trou d'assemblage central (diam : [3] mm)
    Tolerance filet : [0.15] mm (jeu supplementaire)
```

### 12.3 Parametres globaux d'impression 3D

Panneau dans l'UI accessible via un bouton "Reglages impression 3D" :

```javascript
var defaultPrintSettings = {
  // -- Tolerances --
  offsetEntraxe: 0.3,           // mm, augmentation entraxe
  jeuDent: 0.1,                 // mm, jeu radial supplementaire sur profil
  jeuAxial: 0.2,                // mm, jeu entre faces laterales

  // -- Contraintes geometriques --
  angleOverhangMax: 45,         // degres (parametrique 30-60)
  epaisseurParoiMin: 1.2,       // mm
  diamTrouMin: 2.0,             // mm (en dessous, le trou se bouche)
  rayonCongeMin: 0.4,           // mm (conges de raccordement)

  // -- Arbre et trous --
  diamArbre: 5.0,               // mm, diametre du trou central
  ajoutTrouArbre: true,         // soustraire un cylindre central
  typeArbre: 'rond',            // 'rond', 'D-cut', 'hexagonal', 'carre'

  // -- Presets imprimante --
  preset: 'fdm_standard'        // 'fdm_standard', 'fdm_precis', 'sla', 'sls', 'usinage'
};

var PRINT_PRESETS = {
  fdm_standard:  { offsetEntraxe: 0.3, jeuDent: 0.15, angleOverhangMax: 45, epaisseurParoiMin: 1.2 },
  fdm_precis:    { offsetEntraxe: 0.15, jeuDent: 0.10, angleOverhangMax: 50, epaisseurParoiMin: 0.8 },
  sla:           { offsetEntraxe: 0.10, jeuDent: 0.05, angleOverhangMax: 30, epaisseurParoiMin: 0.6 },
  sls:           { offsetEntraxe: 0.15, jeuDent: 0.10, angleOverhangMax: 45, epaisseurParoiMin: 0.8 },
  usinage:       { offsetEntraxe: 0.05, jeuDent: 0.02, angleOverhangMax: 90, epaisseurParoiMin: 0.3 }
};
```

### 12.4 Modifications geometriques pour l'impression

**Appliquees UNIQUEMENT dans le mode export STL (pas en visualisation pure) :**

| Modification | Effet | Quand |
|-------------|-------|-------|
| Offset entraxe | Augmente la distance entre centres | Toujours en mode impression |
| Jeu de dent | Reduit legerement l'epaisseur de dent au profil | Toujours en mode impression |
| Chanfrein sommet dent | Chanfrein 0.2*m a 45deg sur l'arete de tete | Module > 1mm |
| Conge pied dent | Rayon min = `max(0.3*m, rayonCongeMin)` | Toujours |
| Trou d'arbre | Soustraction cylindre central (CSG) | Si `ajoutTrouArbre = true` |
| Arbre D-cut | Aplat sur le trou pour clavetage | Si `typeArbre = 'D-cut'` |
| Chanfrein sous-filet vis | Rampe a 45deg sous le filet helical | Vis sans fin, impression verticale |
| Split bevel | Coupe en 2 avec locators d'alignement | Bevel, si `bevelPrintMode = 'split'` |
| Renfort axe satellite | Diametre minimum des pins | Epicyclic, si diam calcule < min |

### 12.5 Verification et avertissements avant export

Avant de generer les STL, le systeme verifie :

```javascript
function verifierImprimabilite(assembly, printSettings) {
  var warnings = [];

  for (var stage of assembly.stages) {
    var type = stage.typeId;
    var mod = stage.module;

    // Dent trop petite pour la resolution imprimante
    if (mod < 0.8 && printSettings.preset.startsWith('fdm')) {
      warnings.push({
        level: 'error',
        message: 'Module ' + mod + 'mm trop petit pour FDM (min recommande: 0.8mm)'
      });
    }

    // Helice trop raide
    if (type === 'helical') {
      var beta = stage.params.angleHelice || 20;
      if (beta > 90 - printSettings.angleOverhangMax) {
        warnings.push({
          level: 'warning',
          message: 'Angle helice ' + beta + 'deg depasse la limite overhang. Support necessaire.'
        });
      }
    }

    // Vis sans fin : orientation
    if (type === 'worm' && printSettings.wormOrientation === 'horizontal') {
      var lambda = Math.atan(stage.A / 10) * 180 / Math.PI;
      if (lambda < printSettings.angleOverhangMax) {
        warnings.push({
          level: 'warning',
          message: 'Vis sans fin: angle avance ' + lambda.toFixed(1) +
            'deg < overhang ' + printSettings.angleOverhangMax +
            'deg. Impression verticale recommandee.'
        });
      }
    }

    // Epaisseur de paroi (couronne interne, anneau)
    if (type === 'internal') {
      var epaisseurAnneau = 3 * mod; // defaut
      if (epaisseurAnneau < printSettings.epaisseurParoiMin) {
        warnings.push({
          level: 'warning',
          message: 'Epaisseur couronne ' + epaisseurAnneau.toFixed(1) +
            'mm < minimum ' + printSettings.epaisseurParoiMin + 'mm'
        });
      }
    }
  }

  return warnings;
}
```

---

## 13. References Techniques Cles

- [Three.js ExtrudeGeometry](https://threejs.org/docs/#api/en/geometries/ExtrudeGeometry)
- [Three.js ParametricGeometry](https://threejs.org/docs/pages/ParametricGeometry.html)
- [Three.js LatheGeometry](https://threejs.org/docs/#api/en/geometries/LatheGeometry)
- [Manifold Three.js integration](https://manifoldcad.org/three)
- [GearTrain Three.js project](https://github.com/EmptySamurai/GearTrain) - reference pour l'interaction
- [Gear Drawing with Bezier Curves](https://www.arc.id.au/GearDrawing.html) - profil developpante JS
- [gear_generator](https://github.com/jamesgregson/gear_generator) - generateur profil JS
- [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) - CSG alternatif (sans WASM)
- [STLGears.com](https://www.stlgears.com/) - reference UI generateur d'engrenages 3D
- [Drivetrain Hub](https://drivetrainhub.com/gears/) - reference calculs geometriques
- [tec-science Involute](https://www.tec-science.com/mechanical-power-transmission/involute-gear/geometry-of-involute-gears/)
- [KHK Gear Dimensions](https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html)
