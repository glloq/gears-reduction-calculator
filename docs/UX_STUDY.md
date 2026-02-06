# Étude UX - Interface Utilisateur

## Persona utilisateur type

Un ingénieur mécanique ou technicien qui cherche à dimensionner un train de réduction pour une application concrète (machine-outil, robot, convoyeur, etc.).

### Besoins fondamentaux
1. **Trouver** rapidement les combinaisons d'engrenages pour un rapport donné
2. **Comparer** différentes solutions (types, nombre d'étages, rendement, encombrement)
3. **Valider** mécaniquement la solution choisie (résistance, interférence, géométrie)
4. **Exporter** le résultat (schéma, données) pour documentation technique

### Scénarios d'utilisation

**Scénario A : Rapport simple**
L'utilisateur connaît le rapport de réduction voulu (ex: 12:1). Il cherche la solution la plus compacte et efficace.

**Scénario B : Comparaison de technologies**
L'utilisateur hésite entre engrenage droit, courroie et vis sans fin. Il veut comparer rendement, encombrement et coût.

**Scénario C : Transmission multi-sorties**
L'utilisateur a un moteur unique et veut alimenter plusieurs arbres à des vitesses différentes (ex: convoyeur à 3 vitesses). Il cherche un système avec plusieurs rapports de sortie.

**Scénario D : Contrainte d'espace**
L'utilisateur a un espace limité. Il cherche la solution la plus compacte pour un rapport donné, donc privilégie épicycloïdal ou vis sans fin.

---

## Analyse de l'interface actuelle

### Points forts
- Sidebar + contenu : layout classique et efficace
- Sliders double-poignée pour les plages de dents
- Raccourcis clavier (Ctrl+Entrée, Échap)
- SVG interactif avec zoom/pan
- Thème sombre

### Points d'amélioration identifiés

#### 1. Organisation des paramètres
**Problème** : Trop de sections dans la sidebar, l'utilisateur doit scroller pour voir tous les paramètres.
**Solution** : Regrouper en accordéons dépliables. Paramètres essentiels visibles, avancés cachés par défaut.

#### 2. Tri et filtrage des résultats
**Problème** : Les résultats sont triés uniquement par proximité au rapport cible. Pas de filtrage par type ni de tri par rendement ou compacité.
**Solution** : Ajouter des contrôles de tri (colonnes cliquables) et des filtres par type de transmission.

#### 3. Comparaison de solutions
**Problème** : On ne peut voir qu'une solution à la fois dans le détail. Pas de mode "comparer côte à côte".
**Solution** : Système de sélection multiple avec tableau comparatif.

#### 4. Multi-rapports (multi-sorties)
**Problème** : On ne peut chercher qu'un seul rapport à la fois. Pour un système multi-sorties, l'utilisateur doit faire plusieurs recherches séparées.
**Solution** : Interface de recherche multi-rapports avec onglets ou liste de rapports cibles.

#### 5. Retour visuel des types sélectionnés
**Problème** : Les checkboxes de types sont petites et peu visibles.
**Solution** : Cartes de types plus grandes avec icône et résumé, état actif bien marqué.

#### 6. Résumé rapide de la solution
**Problème** : L'analyse mécanique est détaillée mais manque un résumé "carte de visite" avec les 3-4 infos clé.
**Solution** : Mini-carte résumé au-dessus du SVG pour la solution sélectionnée.

---

## Recommandations d'implémentation

### Priorité 1 : Tri et filtrage des résultats
- Colonnes du tableau cliquables pour trier (rapport, écart, rendement, étages)
- Filtre par type de transmission (dropdown ou chips)
- Indicateur du critère de tri actif

### Priorité 2 : Système de comparaison
- Checkbox sur chaque ligne de résultat pour sélectionner
- Bouton "Comparer (N)" qui ouvre un panneau comparatif
- Tableau comparatif côte à côte des solutions sélectionnées
- Graphique radar comparatif

### Priorité 3 : Multi-rapports (multi-sorties)
- Champ de saisie pour ajouter plusieurs rapports cibles
- Recherche combinée cherchant des solutions partageant des étages communs
- Affichage en arbre : étages communs + branches de sortie
- Cas d'usage : boîte de vitesses, système multi-arbres

### Priorité 4 : Amélioration du formulaire
- Sections dépliables (accordéon) dans la sidebar
- Présets de paramètres (robotique, automobile, industriel)
- Tooltip d'aide sur chaque paramètre
