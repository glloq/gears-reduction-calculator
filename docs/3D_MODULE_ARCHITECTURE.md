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
    InvoluteProfile.js     # Profil developpante 2D (partage avec GearSVG)
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

**Poulie :**
- Profil en coupe : trapeze (gorge V) ou plat avec rebords
- `THREE.LatheGeometry(profilCoupe, segments=48)`

**Courroie :**
- Calculer les tangentes entre les deux poulies (entraxe, diametres)
- Tracer le chemin : arc sur poulie A + tangente + arc sur poulie B + tangente
- Extruder une section rectangulaire le long de ce chemin
- Materiau caoutchouc : `MeshStandardMaterial({color: 0x222222, roughness: 0.9})`

Complexite : **Faible**

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

| Type | Entraxe | Axes |
|------|---------|------|
| spur | `m*(Z1+Z2)/2` | paralleles, Z |
| helical | `mn*(Z1+Z2)/(2*cos(beta))` | paralleles, Z |
| internal | `m*(Z2-Z1)/2` | paralleles, Z |
| bevel | Cone distance = `m*Z1/(2*sin(delta))` | 90deg (Z et X) |
| belt | Libre (defaut: `(D1+D2)*2`) | paralleles, Z |
| epicyclic | Sun-planet: `m*(Zs+Zp)/2` | coaxiaux, Z |
| worm | `(q*m + m*Zw)/2` | 90deg offset (Z et Y) |

### 4.3 Arbre entre etages (compound gear)

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

### Phase 4 : Export + edition

**Fichiers :** `Gear3DExporter.js`, modifications `Gear3DInteraction.js`

1. Export STL individuel et groupé (ZIP)
2. Edition : ajout/suppression etage en 3D
3. Modification parametres avec preview en temps reel
4. Undo/redo (Command Pattern)
5. Vue en coupe + vue eclatee (epicyclic)

**Livrable :** Module 3D complet avec export et edition.

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
| Spur 3D | Faible | ExtrudeGeometry simple |
| Helical 3D | Moyenne | Post-twist des vertices |
| Internal 3D | Moyenne | Profil inverse ou CSG |
| Bevel 3D | Elevee | BufferGeometry procedurale, geometrie conique |
| Belt 3D | Faible | LatheGeometry + bande simple |
| Epicyclic 3D | Moyenne | Assemblage multi-composants, InstancedMesh |
| Worm 3D | Elevee | Surface helicoidale parametrique |
| Viewer + controles | Faible | Three.js boilerplate standard |
| Selection + tooltips | Moyenne | Raycasting + CSS2DRenderer |
| Animation | Moyenne | Synchronisation multi-type |
| Export STL | Faible | STLExporter + JSZip |
| Edition interactive | Elevee | Command pattern, UI, live preview |

---

## 12. References Techniques Cles

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
