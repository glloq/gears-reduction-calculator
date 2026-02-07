# Étude UX v2 - Profils Utilisateur & Interface Adaptative

## 1. Deux Profils Utilisateur

### Profil A : Utilisateur Standard
**Qui** : Technicien, étudiant ingénieur, maker/hobbyiste, concepteur non-spécialiste.
**Objectif** : Trouver rapidement un train d'engrenages pour un rapport donné.
**Connaissances** : Sait ce qu'est un rapport de réduction, connaît les types de base (droit, courroie). Ne maîtrise pas les paramètres géométriques fins (angle de pression, module apparent, rapport de conduite).
**Workflow typique** :
1. Saisir le rapport cible
2. Cocher 1-2 types de transmission
3. Lancer la recherche
4. Consulter les 3-5 premiers résultats
5. Visualiser le schéma SVG
6. Exporter si besoin

**Attentes UX** :
- Interface épurée, peu de paramètres visibles
- Résultats clairs avec indicateurs visuels (bon/mauvais)
- Pas de jargon technique excessif
- Valeurs par défaut qui fonctionnent sans modification

### Profil B : Utilisateur Pro
**Qui** : Ingénieur mécanique, bureau d'étude, concepteur de transmissions industrielles.
**Objectif** : Dimensionner un train d'engrenages avec contraintes précises (angle de pression, matériaux, tolérance, encombrement).
**Connaissances** : Maîtrise les normes ISO, connaît les limites d'interférence, les paramètres de Lewis, les contraintes par type.
**Workflow typique** :
1. Définir le rapport cible ET les contraintes mécaniques (angle de pression, module, matériau)
2. Sélectionner les types autorisés avec leurs paramètres spécifiques (angle d'hélice, nb satellites, type courroie)
3. Lancer la recherche
4. Analyser en détail : rendement par étage, contrainte de flexion, facteur de sécurité, rapport de conduite, jeu de denture
5. Comparer plusieurs solutions côte à côte
6. Valider l'interférence et la résistance
7. Exporter les données complètes

**Attentes UX** :
- Accès à TOUS les paramètres de chaque type
- Résultats détaillés (vitesse périphérique, contrainte de flexion, jeu)
- Possibilité de modifier l'angle de pression, le coefficient de frottement, la largeur de dent
- Informations sur l'irréversibilité, la conformité aux normes

---

## 2. Paramètres Non Exposés (Existants dans le Code)

### Paramètres par type (dans TransmissionTypeRegistry.paramsSupplementaires)
| Type | Paramètre | Défaut | Unité | Impact |
|------|-----------|--------|-------|--------|
| Hélicoïdal | Angle d'hélice | 20° | degrés | Module apparent, entraxe, rendement |
| Conique | Angle entre axes | 90° | degrés | Géométrie du cône |
| Courroie | Type de courroie | V | - | Rendement (93-98%) |
| Courroie | Courroie croisée | Non | bool | Sens de rotation |
| Épicycloïdal | Nb satellites | 3 | - | Rendement, encombrement |
| Épicycloïdal | Configuration | Couronne fixe | - | Rapport, sens rotation |
| Vis sans fin | Nb filets | 1 | - | Angle d'avance, irréversibilité |

### Paramètres globaux (hardcodés dans GearMechanics)
| Paramètre | Défaut | Unité | Impact |
|-----------|--------|-------|--------|
| Angle de pression | 20° | degrés | Interférence, forces, rendement |
| Coeff. frottement | 0.04-0.08 | - | Rendement |
| Largeur de dent | 10×module | mm | Résistance Lewis |
| Limite élastique | 250 MPa | MPa | Facteur de sécurité |

### Calculs disponibles mais non affichés
- **Jeu de denture** (backlash par qualité ISO 0-12)
- **Profil en développante** (50 points de courbe)
- **Vitesse périphérique** (m/s, critère bruit/usure)
- **Angles d'enroulement courroie** (degrés)

---

## 3. Solution : Mode Standard / Mode Pro

### Principe
Un toggle "Mode Pro" dans le header de la sidebar bascule l'interface entre les deux modes. Le basculement est instantané (CSS classes), pas de rechargement.

### Mode Standard (défaut)
- Paramètres visibles : rapport cible, types (checkboxes), plages de dents, module (optionnel), étages max
- Sections avancées masquées
- Résultats : tableau actuel (7 colonnes)
- Panneau mécanique : résumé (7 cartes) + tableau par étage simplifié

### Mode Pro (activé par toggle)
- **Tout le mode standard PLUS :**
- Section "Paramètres par type" : champs contextuels selon les types cochés
  - Hélice angle apparaît quand "Hélicoïdal" est coché
  - Nb satellites apparaît quand "Épicycloïdal" est coché
  - etc.
- Section "Paramètres matériaux" : angle de pression, coeff. frottement, largeur de dent, limite élastique
- Résultats enrichis : indicateurs visuels supplémentaires dans les lignes
- Panneau mécanique complet : toutes les données calculées, jeu de denture, vitesse périphérique
- Géométrie détaillée ouverte par défaut (au lieu de collapsed)

---

## 4. Propositions d'Évolution

### 4.1 Paramètres contextuels par type
Quand l'utilisateur coche un type dans la sidebar, un sous-panneau apparaît avec les paramètres spécifiques à ce type. Ceci remplace un formulaire statique par une interface dynamique qui ne montre que ce qui est pertinent.

### 4.2 Résumé solution "carte de visite"
Au-dessus du SVG, une mini-carte affiche les 4 infos clés de la solution sélectionnée : rapport, rendement, étages, types. Permet un aperçu sans scroller jusqu'au panneau mécanique.

### 4.3 Indicateurs dans le tableau de résultats
En mode pro, ajouter des micro-indicateurs dans les cellules du tableau :
- Pastille verte/orange/rouge pour le facteur de sécurité
- Icône si irréversible (vis sans fin)
- Tooltip avec les détails au survol de chaque cellule

### 4.4 Presets d'utilisation
Boutons de préréglage : "Robotique" (compact, épicycloïdal), "Industriel" (robuste, droit), "Automotive" (haut rendement, hélicoïdal). Règle les paramètres et types en un clic.

### 4.5 Export enrichi en mode pro
Export CSV/JSON des résultats complets avec toutes les données mécaniques calculées, pas uniquement le schéma SVG.
