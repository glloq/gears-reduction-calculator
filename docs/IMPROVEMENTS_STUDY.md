# Étude des Améliorations Possibles

> Document de référence — Aucune implémentation, uniquement l'inventaire des améliorations identifiées, classées par priorité, avec avantages attendus.

---

## Table des matières

1. [Corrections critiques (bugs)](#1-corrections-critiques-bugs)
2. [Performance et scalabilité](#2-performance-et-scalabilité)
3. [Visualisation SVG et animations](#3-visualisation-svg-et-animations)
4. [Graphiques (Charts.js)](#4-graphiques-chartsjs)
5. [Système d'export](#5-système-dexport)
6. [Calculs mécaniques avancés](#6-calculs-mécaniques-avancés)
7. [Responsive et mobile](#7-responsive-et-mobile)
8. [Accessibilité (WCAG)](#8-accessibilité-wcag)
9. [Persistance et partage](#9-persistance-et-partage)
10. [Moteur de recherche (Worker)](#10-moteur-de-recherche-worker)
11. [Tableau de résultats](#11-tableau-de-résultats)
12. [Comparaison multi-sorties](#12-comparaison-multi-sorties)
13. [Expérience utilisateur générale](#13-expérience-utilisateur-générale)
14. [Architecture et qualité de code](#14-architecture-et-qualité-de-code)
15. [Matrice de priorisation](#15-matrice-de-priorisation)

---

## 1. Corrections critiques (bugs)

### 1.1 Calcul de précision des graphiques toujours à 0%
- **Constat** : Dans Charts.js, la précision radar compare `rapportTotal - rapportTotal` (toujours 0) au lieu de comparer au rapport cible.
- **Impact** : Le graphique radar affiche des données fausses pour l'axe précision.
- **Avantage de la correction** : Redonner de la fiabilité aux graphiques d'analyse comparative.

### 1.2 Logique inversée du mode réduction-seule dans le Worker
- **Constat** : Le filtre `reductionOnly` dans worker.js est inversé — il exclut les engrenages valides au lieu de filtrer les multiplications.
- **Impact** : Résultats incorrects quand l'utilisateur coche « Réduction uniquement ».
- **Avantage** : Résultats de recherche corrects et cohérents avec les attentes utilisateur.

### 1.3 Nombre de satellites codé en dur (épicycloïdal)
- **Constat** : GearMechanics divise le couple par 3 en dur au lieu d'utiliser le paramètre `nbSatellites` du mode Pro.
- **Impact** : Calculs mécaniques faux pour les trains épicycloïdaux avec 2, 4, 5 ou 6 satellites.
- **Avantage** : Cohérence entre les paramètres saisis et les résultats affichés.

### 1.4 Direction de zoom inversée dans le SVG
- **Constat** : `deltaY > 0` applique un facteur 1.1 (agrandissement) au lieu de 0.9 (rétrécissement).
- **Impact** : Le zoom est à l'envers de la convention standard (scroll vers le bas = dézoom).
- **Avantage** : Interaction intuitive conforme aux conventions habituelles.

---

## 2. Performance et scalabilité

### 2.1 Analyse mécanique exécutée pour chaque résultat à l'affichage
- **Constat** : `ResultsTable._prepareDisplayData()` lance `analyserTrainEngrenages()` sur chaque solution synchroniquement.
- **Impact** : Avec 50+ résultats, l'interface se fige pendant plusieurs secondes.
- **Avantage d'une optimisation** : Affichage instantané même avec des centaines de résultats. Expérience fluide.
- **Piste** : Calcul différé (lazy) — analyser uniquement les solutions visibles ou au clic.

### 2.2 Virtualisation du tableau de résultats
- **Constat** : Le tableau DOM contient toutes les lignes, même pour 500+ résultats.
- **Impact** : Ralentissement du rendu, consommation mémoire excessive.
- **Avantage** : Fluidité garantie quelle que soit la taille des résultats.
- **Piste** : Afficher uniquement les lignes visibles (virtual scrolling) ou pagination.

### 2.3 Cache des profils de dents SVG
- **Constat** : `_generateToothProfile()` recalcule le profil développante à chaque dessin.
- **Impact** : Temps de rendu inutilement long pour des engrenages identiques.
- **Avantage** : Rendu SVG 2-5× plus rapide avec mise en cache par (nbDents, module).

### 2.4 Re-création complète des graphiques
- **Constat** : Chaque mise à jour détruit et recrée les instances Chart.js.
- **Impact** : Scintillement visuel, consommation mémoire, délai de rendu.
- **Avantage** : Mises à jour visuellement fluides, transitions animées entre états.

### 2.5 Calcul maxRatio recalculé dans la boucle interne du Worker
- **Constat** : `Math.max(...activeTypes.map(...))` est appelé à l'intérieur de la boucle de recherche.
- **Impact** : Opération O(n) répétée des millions de fois.
- **Avantage** : Réduction du temps de recherche via un pré-calcul unique.

---

## 3. Visualisation SVG et animations

### 3.1 Animations manquantes pour 4 types de transmission
- **Constat** : Seuls les engrenages droits et hélicoïdaux ont une animation correcte. Manquent : courroie (défilement), vis sans fin (axes 90°), épicycloïdal (orbite satellites), conique (axes 90°).
- **Avantage** : Compréhension visuelle immédiate du fonctionnement pour chaque type.

### 3.2 Visualisation hélicoïdale simplifiée
- **Constat** : L'engrenage hélicoïdal est dessiné identiquement au droit — aucune indication visuelle de l'hélice.
- **Avantage** : Différenciation visuelle claire entre types, valeur pédagogique accrue.

### 3.3 Rendu conique simplifié (2D)
- **Constat** : Les engrenages coniques sont représentés comme des droits — pas de perspective 3D ou vue de coupe.
- **Avantage** : Représentation plus réaliste, meilleure compréhension de la géométrie.

### 3.4 Adaptation au thème sombre
- **Constat** : Les couleurs SVG sont codées en dur (#fafafa, #ccc) — aucune adaptation au dark mode.
- **Avantage** : Cohérence visuelle complète entre le thème de l'interface et les schémas.

### 3.5 Tooltips et zoom/pan
- **Constat** : Les coordonnées des tooltips ne tiennent pas compte des transformations zoom/pan.
- **Impact** : Tooltips mal positionnés après un zoom ou un déplacement.
- **Avantage** : Interaction fiable à tout niveau de zoom.

---

## 4. Graphiques (Charts.js)

### 4.1 Nouveaux types de graphiques
- **Graphique d'interférence** : Visualiser les zones de conflit entre dents pour chaque étage.
- **Graphique des facteurs de sécurité** : Barres comparatives (Lewis, Hertz, fatigue) par étage.
- **Graphique de compacité** : Comparer la taille physique des solutions (encombrement).
- **Graphique d'évolution** : Courbe couple/vitesse le long du train complet.
- **Avantage** : Aide à la décision multi-critères, vision complète d'une solution.

### 4.2 Export des graphiques
- **Constat** : Aucune possibilité de sauvegarder les graphiques en image.
- **Avantage** : Intégration dans des rapports techniques ou des présentations.

### 4.3 Superposition comparative
- **Constat** : Impossible de superposer deux solutions sur un même graphique.
- **Avantage** : Comparaison directe et visuelle entre solutions candidates.

### 4.4 Suppression de la dépendance au plugin annotation
- **Constat** : Le code référence le plugin annotation Chart.js sans vérifier sa présence.
- **Avantage** : Élimination d'une erreur silencieuse, fonctionnement garanti.

---

## 5. Système d'export

### 5.1 Export PDF
- **Constat** : Seuls SVG et PNG sont disponibles.
- **Avantage** : Format professionnel standard pour les rapports d'ingénierie. Impression propre.

### 5.2 Export CSV/Excel des résultats
- **Constat** : Le tableau de résultats n'est pas exportable.
- **Avantage** : Exploitation des données dans un tableur, tri/filtre avancé, partage avec des collègues.

### 5.3 Export JSON des données d'analyse
- **Constat** : Les résultats d'analyse mécanique ne sont pas exportables.
- **Avantage** : Réutilisation dans d'autres outils de calcul, archivage structuré.

### 5.4 Export DXF/DWG (formats CAO)
- **Constat** : Aucun format exploitable par les logiciels de CAO.
- **Avantage** : Intégration directe dans le workflow de conception mécanique (SolidWorks, AutoCAD, etc.).

### 5.5 Export groupé (ZIP)
- **Constat** : Chaque export est individuel.
- **Avantage** : Un clic pour obtenir schéma SVG + graphiques + données CSV + rapport dans une archive.

### 5.6 Feuille de style impression
- **Constat** : Aucun `@media print` défini.
- **Avantage** : Impression directe depuis le navigateur avec une mise en page optimisée.

---

## 6. Calculs mécaniques avancés

### 6.1 Contrainte de Hertz (contact)
- **Constat** : Seule la contrainte de Lewis (flexion) est calculée. La contrainte de contact (Hertz) est absente.
- **Avantage** : Évaluation complète de la résistance — Hertz est souvent le facteur limitant en pratique.

### 6.2 Analyse de fatigue
- **Constat** : Aucune estimation de durée de vie en fatigue.
- **Avantage** : Information critique pour la conception : combien de cycles avant défaillance.

### 6.3 Facteurs de charge dynamiques
- **Constat** : Les calculs utilisent des charges statiques uniquement.
- **Avantage** : Résultats plus réalistes tenant compte des vibrations, accélérations et chocs.

### 6.4 Rendement spécifique vis sans fin
- **Constat** : Le rendement vis sans fin utilise une formule générique au lieu de la formule spécifique (angle d'hélice + frottement).
- **Avantage** : Les vis sans fin ayant un rendement très variable (30-90%), une formule précise change significativement les résultats.

### 6.5 Calculs courroie/poulie
- **Constat** : Aucun calcul de tension, glissement ou contrainte pour les courroies.
- **Avantage** : Mode Pro complet pour les transmissions par courroie.

### 6.6 Estimation thermique
- **Constat** : Aucune estimation de l'échauffement.
- **Avantage** : Identification des configurations nécessitant un refroidissement ou une lubrification renforcée.

### 6.7 Estimation du niveau sonore
- **Constat** : Pas d'indicateur de bruit/vibration.
- **Avantage** : Critère de sélection important dans de nombreuses applications (équipements médicaux, bureautique, etc.).

---

## 7. Responsive et mobile

### 7.1 Navigation mobile (sidebar collapsible)
- **Constat** : La sidebar reste fixe, prend trop de place sur mobile.
- **Avantage** : Utilisation confortable sur smartphone, plus d'espace pour les résultats.
- **Piste** : Menu hamburger ou sidebar en overlay glissant.

### 7.2 Breakpoint 320px (petits téléphones)
- **Constat** : Le breakpoint le plus petit est 480px. Pas de règles pour 320-479px.
- **Avantage** : Compatibilité avec tous les smartphones, y compris les plus petits.

### 7.3 Breakpoint grands écrans (>1920px)
- **Constat** : Aucune optimisation pour les écrans 4K/ultrawide.
- **Avantage** : Exploitation de l'espace disponible sur les grands écrans de bureau.

### 7.4 Gestes tactiles sur le SVG
- **Constat** : Le zoom/pan SVG est uniquement souris (wheel + drag).
- **Avantage** : Interaction naturelle sur tablette/téléphone (pinch-to-zoom, swipe).

### 7.5 Taille des cibles tactiles
- **Constat** : Boutons et checkboxes non dimensionnés pour le tactile (minimum recommandé : 44×44px).
- **Avantage** : Conformité aux guidelines d'ergonomie mobile (Apple HIG, Material Design).

### 7.6 Typographie responsive
- **Constat** : Tailles de police fixes.
- **Avantage** : Lisibilité optimale quelle que soit la taille d'écran.

---

## 8. Accessibilité (WCAG)

### 8.1 Labels et associations de formulaire
- **Constat** : Les checkboxes de types n'ont pas d'attribut `id`, les labels n'utilisent pas `for`.
- **Avantage** : Navigation au clavier fonctionnelle, compatibilité lecteurs d'écran.

### 8.2 Attributs ARIA
- **Constat** : Aucun `aria-label`, `aria-live`, `role` sur les éléments interactifs.
- **Avantage** : Accessibilité pour les utilisateurs de technologies d'assistance.

### 8.3 Régions dynamiques (live regions)
- **Constat** : Les mises à jour (résultats, progression, status) ne sont pas annoncées aux lecteurs d'écran.
- **Avantage** : Utilisateurs non-voyants informés de l'avancement et des résultats.

### 8.4 Navigation au clavier dans le tableau
- **Constat** : Pas de navigation par flèches, pas de focus visible sur les lignes.
- **Avantage** : Utilisation complète de l'app sans souris.

### 8.5 Alternatives textuelles pour les graphiques et SVG
- **Constat** : Aucun `alt`, `title`, `desc` ou `role="img"` sur les visualisations.
- **Avantage** : Informations accessibles en texte pour chaque visualisation.

### 8.6 Contraste et indicateurs visuels
- **Constat** : Les indicateurs de tri et filtres reposent uniquement sur la couleur.
- **Avantage** : Utilisabilité pour les daltoniens et en conditions de faible contraste.

### 8.7 Lien « Aller au contenu »
- **Constat** : Pas de skip link.
- **Avantage** : Navigation rapide au clavier sans parcourir toute la sidebar.

---

## 9. Persistance et partage

### 9.1 Sauvegarde complète des paramètres
- **Constat** : `SearchParams.save()` ne sauvegarde pas les valeurs des sliders, les types cochés, ni le mode réduction-seule.
- **Avantage** : Restauration fidèle de tous les paramètres entre sessions.

### 9.2 URL partageable avec paramètres encodés
- **Constat** : Impossible de partager une configuration par lien.
- **Avantage** : Partage instantané d'une configuration entre collègues, bookmarks de recherches fréquentes.

### 9.3 Presets nommés
- **Constat** : Pas de jeux de paramètres prédéfinis.
- **Avantage** : Démarrage rapide pour les cas courants (« Réducteur haute vitesse », « Couple fort basse vitesse », « Épicycloïdal compact »).
- **Piste** : Bibliothèque de presets standard + presets utilisateur personnalisés.

### 9.4 Import/export de configuration (fichier JSON)
- **Constat** : La persistance est limitée au localStorage.
- **Avantage** : Transfert de configurations entre machines, backup, intégration dans des workflows.

### 9.5 Sauvegarde de l'état de comparaison
- **Constat** : Le ComparisonManager perd son état au rechargement.
- **Avantage** : Reprise du travail de comparaison sans ressaisie des ratios cibles.

### 9.6 Validation des données restaurées
- **Constat** : Aucune vérification d'intégrité des données localStorage.
- **Avantage** : Robustesse face à des données corrompues ou obsolètes.

---

## 10. Moteur de recherche (Worker)

### 10.1 Résultats incrémentaux (« best so far »)
- **Constat** : Le Worker ne retourne les résultats qu'à la fin complète de la recherche.
- **Avantage** : L'utilisateur voit les premières solutions immédiatement, peut arrêter tôt si satisfait.

### 10.2 Élagage amélioré (pruning)
- **Constat** : L'élagage upper-bound utilise un multiplicateur arbitraire ×1.5.
- **Avantage** : Réduction significative de l'espace de recherche, résultats plus rapides.
- **Piste** : Best-first search, branch-and-bound, bornes mathématiques précises par type.

### 10.3 Dédoublonnage des résultats
- **Constat** : Deux solutions de types différents donnant le même ratio sont toutes deux retournées.
- **Avantage** : Résultats plus propres, moins de redondance.

### 10.4 Pondération / préférence des types
- **Constat** : Tous les types sont traités avec la même priorité.
- **Avantage** : L'utilisateur peut favoriser les types les plus pertinents pour son contexte (ex : privilégier droit + hélicoïdal en mécanique de précision).

### 10.5 Mémoïsation des sous-calculs
- **Constat** : Aucun cache des rapports déjà calculés dans le Worker.
- **Avantage** : Éviter de recalculer les mêmes combinaisons dans les recherches multi-étages.

### 10.6 Annulation propre de la recherche
- **Constat** : L'arrêt de recherche est géré de façon basique.
- **Avantage** : Annulation instantanée et libération immédiate des ressources.

---

## 11. Tableau de résultats

### 11.1 Pagination
- **Constat** : Tous les résultats sont affichés d'un bloc dans le DOM.
- **Avantage** : Performance stable même avec des milliers de résultats. Navigation par pages.

### 11.2 Recherche textuelle dans les résultats
- **Constat** : Le filtrage se limite au type de transmission.
- **Avantage** : Recherche rapide d'une solution par nombre de dents, ratio, etc.

### 11.3 Export CSV du tableau filtré
- **Constat** : Aucun export des résultats du tableau.
- **Avantage** : Exploitation dans un tableur pour analyse approfondie.

### 11.4 Masquage/affichage de colonnes
- **Constat** : Toutes les colonnes sont toujours visibles.
- **Avantage** : Personnalisation de la vue selon les besoins (mode Standard : moins de colonnes, mode Pro : toutes).

### 11.5 Copier une ligne dans le presse-papier
- **Constat** : Pas de fonctionnalité de copie.
- **Avantage** : Transfert rapide des données vers un document ou un mail.

### 11.6 Regroupement par nombre d'étages ou par type
- **Constat** : Les résultats sont une liste plate.
- **Avantage** : Organisation visuelle facilitant la comparaison au sein d'une catégorie.

---

## 12. Comparaison multi-sorties

### 12.1 Visualisation côte à côte des schémas SVG
- **Constat** : La comparaison est uniquement tabulaire.
- **Avantage** : Comparaison visuelle immédiate des géométries.

### 12.2 Graphiques combinés multi-sorties
- **Constat** : Pas de graphiques superposant les différentes sorties.
- **Avantage** : Vue synthétique des performances comparées (radar overlay, etc.).

### 12.3 Analyse de Pareto
- **Constat** : Pas de suggestion automatique de la meilleure solution.
- **Avantage** : Identification automatique des solutions optimales multi-critères (ratio vs nombre de dents vs rendement vs compacité).

### 12.4 Persistance des scénarios de comparaison
- **Constat** : Les ratios cibles sont perdus au rechargement.
- **Avantage** : Continuité du travail de comparaison.

### 12.5 Export du rapport de comparaison
- **Constat** : Aucun export dédié.
- **Avantage** : Documentation formelle du processus de sélection.

---

## 13. Expérience utilisateur générale

### 13.1 Aide contextuelle et guide des raccourcis clavier
- **Constat** : Aucune aide intégrée, raccourcis non documentés (Ctrl+Enter, Escape).
- **Avantage** : Prise en main rapide, découvrabilité des fonctionnalités.
- **Piste** : Modale d'aide (?) + tooltips sur les paramètres.

### 13.2 Support PWA / mode hors-ligne
- **Constat** : Pas de Service Worker, pas de manifest.json.
- **Avantage** : Utilisation sans connexion, installation sur l'écran d'accueil mobile.

### 13.3 Indicateur de chargement initial
- **Constat** : Pas de spinner ni de skeleton pendant le chargement des scripts.
- **Avantage** : Retour visuel immédiat, perception de rapidité.

### 13.4 Tag `<noscript>`
- **Constat** : Aucun message si JavaScript est désactivé.
- **Avantage** : Information claire au lieu d'une page blanche.

### 13.5 Fallback CDN
- **Constat** : noUiSlider et Chart.js chargés uniquement depuis CDN, sans fallback local.
- **Avantage** : Fonctionnement garanti même si le CDN est indisponible.

### 13.6 Internationalisation (i18n)
- **Constat** : Tout le texte est codé en dur en français.
- **Avantage** : Possibilité d'ajouter l'anglais ou d'autres langues, audience élargie.
- **Piste** : Fichier de traductions JSON, sélecteur de langue.

### 13.7 Historique des recherches
- **Constat** : Aucun historique des recherches précédentes.
- **Avantage** : Navigation rapide entre configurations testées, comparaison avec les résultats passés.

---

## 14. Architecture et qualité de code

### 14.1 Tests unitaires
- **Constat** : Aucun test automatisé.
- **Avantage** : Fiabilité des calculs garantie, régressions détectées immédiatement.
- **Piste** : Jest ou Mocha pour les fonctions de calcul (GearMechanics, SearchParams, Worker).

### 14.2 Duplication Worker / Engine fallback
- **Constat** : Les contraintes de types et la logique de recherche sont dupliquées entre `worker.js` et `Engine.js`.
- **Avantage** : Source unique de vérité, maintenance simplifiée.
- **Piste** : Module partagé importé par les deux via importScripts ou build step.

### 14.3 Fonctions inutilisées dans GearMechanics
- **Constat** : `genererProfilDeveloppante`, `verifierInterference`, `calculerJeuDenture` sont définies mais jamais appelées.
- **Avantage** : Code plus propre, ou intégration effective de ces calculs dans l'interface.

### 14.4 Migration vers des modules ES6
- **Constat** : Architecture IIFE + namespace manuelle.
- **Avantage** : Imports explicites, tree-shaking, outillage moderne (bundler, linting).
- **Note** : Changement structurel majeur, à planifier comme évolution long terme.

### 14.5 Linting et formatage automatique
- **Constat** : Pas d'ESLint ni de Prettier configurés.
- **Avantage** : Cohérence du code, détection précoce d'erreurs.

---

## 15. Matrice de priorisation

| Priorité | Amélioration | Effort | Impact |
|----------|-------------|--------|--------|
| **P0 — Critique** | Correction bug précision radar (§1.1) | Faible | Fort |
| **P0** | Correction logique réduction-seule Worker (§1.2) | Faible | Fort |
| **P0** | Correction nbSatellites épicycloïdal (§1.3) | Faible | Fort |
| **P0** | Correction direction zoom SVG (§1.4) | Faible | Moyen |
| **P1 — Haute** | Calcul différé dans ResultsTable (§2.1) | Moyen | Fort |
| **P1** | Sauvegarde complète des paramètres (§9.1) | Moyen | Fort |
| **P1** | Résultats incrémentaux Worker (§10.1) | Moyen | Fort |
| **P1** | Rendement vis sans fin spécifique (§6.4) | Moyen | Fort |
| **P1** | Contrainte de Hertz (§6.1) | Moyen | Fort |
| **P2 — Moyenne** | Animations 4 types manquants (§3.1) | Élevé | Fort |
| **P2** | Export CSV/Excel résultats (§5.2) | Moyen | Fort |
| **P2** | Export PDF (§5.1) | Élevé | Fort |
| **P2** | Navigation mobile / sidebar (§7.1) | Élevé | Fort |
| **P2** | Presets nommés (§9.3) | Moyen | Moyen |
| **P2** | Pagination résultats (§11.1) | Moyen | Moyen |
| **P2** | Adaptation SVG thème sombre (§3.4) | Faible | Moyen |
| **P2** | URL partageable (§9.2) | Moyen | Moyen |
| **P3 — Basse** | Accessibilité WCAG (§8 complet) | Élevé | Moyen |
| **P3** | Graphiques supplémentaires (§4.1) | Élevé | Moyen |
| **P3** | Export DXF/CAO (§5.4) | Élevé | Moyen |
| **P3** | Tests unitaires (§14.1) | Élevé | Fort |
| **P3** | PWA / hors-ligne (§13.2) | Élevé | Faible |
| **P3** | Internationalisation (§13.6) | Élevé | Moyen |
| **P3** | Analyse de Pareto (§12.3) | Élevé | Moyen |
| **P3** | Migration ES6 modules (§14.4) | Très élevé | Faible |

> **Légende effort** : Faible (<1h) · Moyen (1-4h) · Élevé (4h+) · Très élevé (refonte)
> **Légende impact** : Fort (correctif critique ou UX majeure) · Moyen (amélioration notable) · Faible (nice-to-have)

---

*Document généré le 07/02/2026 — Base : audit complet de toutes les sources de l'application.*
