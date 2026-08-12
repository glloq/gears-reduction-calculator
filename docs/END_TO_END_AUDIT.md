# Audit end-to-end des paramètres (état initial d139b8a)

| Contrôle UI / id | SearchParams / worker | Consommateur et effet | Couverture |
|---|---|---|---|
| Rapport `rapport`, mode `objective_mode` | `rapportCible`, `objectiveMode` | SearchEngine (ratio); dérivé des RPM en need; ignoré en linéaire | search-params + engine + E2E |
| RPM/couple entrée `vitesse_entree`, `couple_entree` | propriétés homonymes | Engineering / LinearDriveSolver | search-params + linear |
| RPM cible/min/max, couple min | `rapportCible`, contraintes output | SearchEngine mécanique | search-params + engine |
| Course/vitesses/force linéaires | `linearTravelPerRevolutionMm`, contraintes linéaires | LinearDriveSolver | search-params + linear-drive |
| Module fixe/auto/min/max | `module*` | choix de modules des deux solveurs | search-params + engine |
| SF/SH | contraintes optionnelles | Engineering, rejet mechanics | search-params + engine |
| Dimensions max | `constraints.max*` | Engineering.validateDimensions | engineering/engine |
| Types et paramètres de type | `typesActifs`, `typeParameters` | TransmissionRegistry; rack exclusif en linéaire | engine + UI |
| Mode de recherche / poids | `searchMode`, `weights` | tri/score SearchEngine | engine |
| Matériaux / fabrication | propriétés et `manufacturing` | Engineering / ManufacturingRules | engineering-contract |
| Fatigue / arbre | `fatigue`, `shaft` | Engineering | engineering |

## Défauts confirmés lors de l'audit

SF/SH cachés imposaient des valeurs par défaut puis étaient corrigés par un monkey-patch de présentation; les trois contraintes linéaires étaient créées tardivement mais jamais sérialisées vers le worker; les champs cachés restaient actifs; rack apparaissait comme combinable en rotatif; le module fixe vide devenait silencieusement 1; les cartes linéaires affichaient un rapport absent et des sorties rotatives vides; les warnings objets étaient convertis par `String`; l'absence de candidats n'avait pas de raison structurée. Ces raccordements sont désormais centralisés dans SearchParams et les solveurs.
