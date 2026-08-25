# Captures d'écran

Ce dossier montre l'application. Il ne prouve rien : les références de
régression, comparées au pixel près, vivent dans
`tests/e2e/*-regression.spec.js-snapshots/`. Ces images-ci sont là pour qu'on
sache à quoi ressemble le logiciel sans avoir à le lancer.

Toutes sont produites par le même parcours qu'un utilisateur — le modal, la
recherche, les onglets — et non par un montage.

| Image | Ce qu'elle montre |
|---|---|
| `01-recherche-intention.png` | Le premier écran : ce qu'on veut faire, avant ce qu'on cherche. |
| `02-recherche-besoin.png` | L'étape Besoin : les grandeurs connues, posées une par une. |
| `03-recherche-affiner.png` | L'étape Affiner : priorité de score, contraintes, options repliées. |
| `04-construire.png` | Le mode Construire : la chaîne décrite étage par étage, ce qui reste à trouver. |
| `05-espace-de-travail.png` | L'écran complet : solutions à gauche, dessin au centre, décision à droite. |
| `06-carte-recommandee.png` | La carte recommandée, avec son rang, ses gains et ses alertes. |
| `07-tableau-expert.png` | La vue tableau, qui prend toute la largeur : rang, contrôles, dimensions. |
| `08-vue-transmission.png` | Vue Transmission : comment le mécanisme est assemblé. |
| `09-vue-dimensions.png` | Vue Dimensions : axes, diamètres, entraxes, encombrement. |
| `10-vue-cinematique.png` | Vue Cinématique : qui entraîne quoi, à quelle vitesse, dans quel sens. |
| `11-inspecteur-etage.png` | L'inspecteur : cliquer une roue désigne LA ROUE, ses cotes et sa vitesse. |
| `12-analyse-mecanique.png` | La cascade des vitesses et l'analyse mécanique de la solution retenue. |
| `13-editeur.png` | L'éditeur : chaque étage modifiable, l'écart avec l'état d'avant. |
| `14-comparaison.png` | Deux solutions épinglées côte à côte, silhouette comprise. |
| `15-graphiques.png` | Le nuage de compromis encombrement / rendement, front de Pareto visible. |
| `16-mobile-solutions.png` | La même application en 390 px : trois volets, un à la fois. |
| `17-mobile-vue.png` | Le dessin sur téléphone, à pleine largeur. |

## Les régénérer

```sh
npm install
npx playwright install chromium
npm run screenshots
```

Les images sont réécrites sur place. La suite E2E ordinaire ne les touche pas :
sans `SHOTS=1`, `tests/e2e/screenshots.spec.js` est ignoré, pour qu'un
`npm run test:e2e` ne réécrive pas dix-sept fichiers versionnés.

Chart.js et noUiSlider viennent d'un CDN dans `index.html`. Le harnais sert à
leur place les copies installées dans `node_modules` : les graphiques se
peignent donc même hors ligne, et l'image montre l'écran tel qu'il est en ligne.
