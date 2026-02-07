/**
 * @file GearMechanics.js - Calculs d'ingénierie mécanique avancés
 *
 * Ce module regroupe toutes les fonctions de calcul mécanique utilisées
 * pour analyser un train d'engrenages : résistance des dents (Lewis),
 * contrainte de contact (Hertz/ISO 6336), rapport de conduite,
 * vérification d'interférence, profil en développante de cercle, etc.
 *
 * Supporte les 7 types de transmission enregistrés dans le
 * TransmissionTypeRegistry : engrenages droits (spur), hélicoïdaux
 * (helical), internes, coniques (bevel), courroies (belt),
 * épicycloïdaux et vis sans fin (worm).
 *
 * Toutes les méthodes sont statiques et regroupées dans l'objet
 * `GearMechanics`. Les unités utilisées sont :
 *   - Module (mm), forces (N), contraintes (MPa), couples (N.m),
 *     vitesses (tr/min), puissances (W), angles (degrés sauf mention)
 *
 * @namespace GearApp.core.GearMechanics
 */

(function (GearApp) {

  var GearMechanics = {};

  // =========================================================================
  // ===== Analyse complète d'un train d'engrenages =====
  // =========================================================================

  /**
   * Réalise l'analyse mécanique complète d'un train de transmission multi-étages.
   *
   * Pour chaque étage, calcule :
   *   - Le rapport de réduction et la géométrie (via le registre de types)
   *   - Le rendement et le sens de rotation
   *   - Les vitesses et couples d'entrée/sortie
   *   - La puissance transmise et les pertes
   *   - La résistance en flexion (Lewis) pour les engrenages à dents
   *   - La contrainte de contact (Hertz) pour les engrenages cylindriques
   *   - Le rapport de conduite (droits et hélicoïdaux)
   *   - La vitesse périphérique
   *
   * @param {Array<Array>} solution - Tableau d'étages au format [[A, B, typeId], ...].
   *   A = nombre de dents menante, B = nombre de dents menée,
   *   typeId = identifiant du type de transmission.
   * @param {Object} [params] - Paramètres optionnels de l'analyse
   * @param {number} [params.module=2] - Module métrique (mm)
   * @param {number} [params.vitesseEntree=1500] - Vitesse de rotation d'entrée (tr/min)
   * @param {number} [params.coupleEntree=10] - Couple d'entrée (N.m)
   * @param {number} [params.angleContact=20] - Angle de pression (degrés)
   * @param {number} [params.largeurDent] - Largeur de dent (mm), par défaut 10 * module
   * @param {number} [params.limiteElastique=250] - Limite élastique du matériau (MPa)
   * @param {number} [params.coeffFrottement] - Coefficient de frottement
   * @param {number} [params.angleHelice] - Angle d'hélice (degrés, pour hélicoïdaux)
   * @param {string} [params.typeCourroie] - Type de courroie (pour transmission par courroie)
   * @param {number} [params.nbSatellites] - Nombre de satellites (pour épicycloïdaux)
   * @param {number} [params.limiteContact] - Limite de contrainte de contact (MPa)
   * @returns {Object} Résultat de l'analyse contenant :
   *   - {Array<Object>} etages           — détail de chaque étage
   *   - {number} rapportTotal             — rapport de réduction global
   *   - {number} rendementTotal           — rendement global (produit des rendements)
   *   - {number} sensRotationTotal        — sens de rotation final (+1 ou -1)
   *   - {number} vitesseEntree/Sortie     — vitesses extrêmes (tr/min)
   *   - {number} coupleEntree/Sortie      — couples extrêmes (N.m)
   *   - {number} puissanceEntree/Sortie   — puissances extrêmes (W)
   *   - {number} nombreEtages             — nombre total d'étages
   */
  GearMechanics.analyserTrainEngrenages = function (solution, params) {
    params = params || {};
    var registry = GearApp.models.typeRegistry;
    var mod = params.module || 2;
    var vitesseEntree = params.vitesseEntree || 1500;
    var coupleEntree = params.coupleEntree || 10;
    var angleContact = params.angleContact || 20;
    var largeurDent = params.largeurDent || (10 * mod);
    var limiteElastique = params.limiteElastique || 250;

    var etages = [];
    var vitesseCourante = vitesseEntree;
    var coupleCourant = coupleEntree;
    var rendementTotal = 1;
    var rapportTotal = 1;
    var sensRotationTotal = 1;

    // ===== Boucle principale : analyse étage par étage =====

    for (var i = 0; i < solution.length; i++) {
      var stageData = solution[i];
      var A = stageData[0];             // Nombre de dents de la roue menante
      var B = stageData[1];             // Nombre de dents de la roue menée
      var typeId = stageData[2] || 'spur'; // Type de transmission (défaut : droits)
      var type = registry.get(typeId);

      // --- Rapport et géométrie ---
      var rapport = type.calculerRapport(A, B);
      rapportTotal *= rapport;

      var geometrie = type.calculerGeometrie(A, B, mod, { angleContact: angleContact });

      // --- Rendement de l'étage ---
      var rendementEtage = type.calculerRendement(A, B, {
        angleContact: angleContact, coeffFrottement: params.coeffFrottement, module: mod,
        angleHelice: params.angleHelice, typeCourroie: params.typeCourroie,
        nbSatellites: params.nbSatellites
      });
      rendementTotal *= rendementEtage;

      // --- Sens de rotation ---
      var sensEtage = type.sensRotation(A, B, params);
      sensRotationTotal *= sensEtage;

      // --- Cinématique et énergétique ---
      // Vitesse de sortie : divisée par le rapport (réduction)
      var vitesseSortie = vitesseCourante / rapport;
      // Couple de sortie : multiplié par le rapport et le rendement
      var coupleSortie = coupleCourant * rapport * rendementEtage;
      // Puissance = couple (N.m) * vitesse angulaire (rad/s)
      // avec omega = 2*pi*N/60 (conversion tr/min -> rad/s)
      var puissanceEntree = (coupleCourant * vitesseCourante * 2 * Math.PI) / 60;
      var puissanceSortie = puissanceEntree * rendementEtage;
      var pertePuissance = puissanceEntree - puissanceSortie;

      // --- Résistance mécanique ---
      // Valeurs par défaut (infiniment résistant — utilisé pour les courroies)
      var resistanceMenante = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      var resistanceMenee = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      var hertzContact = null;
      var rapportConduite = null;
      var vitessePeripherique = 0;

      // Les courroies n'ont pas de dents — on saute les calculs de résistance
      if (typeId !== 'belt') {
        if (typeId === 'worm') {
          // Vis sans fin : seule la roue menée (roue à vis) est vérifiée en Lewis.
          // La vis elle-même est considérée comme suffisamment résistante (facteur fixe).
          resistanceMenee = GearMechanics.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
          resistanceMenante = { facteurSecurite: 3.0, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
        } else if (typeId === 'epicyclic') {
          // Épicycloïdal : le nombre de dents du satellite est (B - A) / 2.
          // Le couple sur chaque satellite est réparti entre les nbSat satellites.
          var dentsSat = (B - A) / 2;
          var nbSat = params.nbSatellites || 3;
          resistanceMenante = GearMechanics.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = GearMechanics.calculerResistanceLewis(Math.max(6, dentsSat), mod, largeurDent, coupleSortie / nbSat, limiteElastique);
        } else {
          // Cas général (droits, hélicoïdaux, internes, coniques)
          resistanceMenante = GearMechanics.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = GearMechanics.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
        }

        // Contrainte de Hertz (contact) pour les engrenages cylindriques et coniques.
        // Complète l'analyse Lewis (flexion) pour une évaluation résistance complète.
        if (typeId === 'spur' || typeId === 'helical' || typeId === 'bevel' || typeId === 'internal') {
          hertzContact = GearMechanics.calculerContrainteHertz(A, B, mod, largeurDent, coupleCourant, {
            angleContact: angleContact,
            limiteContact: params.limiteContact,
            isInternal: typeId === 'internal'
          });
        }

        // Rapport de conduite : uniquement pour les engrenages droits et hélicoïdaux
        // (mesure de la continuité d'engrènement ; doit être > 1 pour un fonctionnement correct)
        if (typeId === 'spur' || typeId === 'helical') {
          rapportConduite = GearMechanics.calculerRapportConduite(A, B, angleContact);
        }

        // Vitesse périphérique au cercle primitif (m/s)
        vitessePeripherique = GearMechanics.calculerVitessePeripherique(A, mod, vitesseCourante);
      }

      // --- Assemblage du résultat pour cet étage ---
      etages.push({
        index: i, typeId: typeId,
        typeNom: type.nom, typeNomCourt: type.nomCourt,
        typeIcone: type.icone, axesRelation: type.axesRelation,
        reversible: type.reversible !== false,
        dentsMenante: A, dentsMenee: B,
        labelA: type.labelA, labelB: type.labelB,
        uniteA: type.uniteA, uniteB: type.uniteB,
        rapport: rapport, geometrie: geometrie,
        rendement: rendementEtage, sensRotation: sensEtage,
        vitesseEntree: vitesseCourante, vitesseSortie: vitesseSortie,
        coupleEntree: coupleCourant, coupleSortie: coupleSortie,
        puissanceEntree: puissanceEntree, puissanceSortie: puissanceSortie,
        pertePuissance: pertePuissance,
        resistanceMenante: resistanceMenante, resistanceMenee: resistanceMenee,
        hertzContact: hertzContact,
        rapportConduite: rapportConduite, vitessePeripherique: vitessePeripherique
      });

      // Propager les valeurs de sortie comme entrées de l'étage suivant
      vitesseCourante = vitesseSortie;
      coupleCourant = coupleSortie;
    }

    // ===== Résultat global du train =====

    return {
      etages: etages, rapportTotal: rapportTotal,
      rendementTotal: rendementTotal, sensRotationTotal: sensRotationTotal,
      vitesseEntree: vitesseEntree, vitesseSortie: vitesseCourante,
      coupleEntree: coupleEntree, coupleSortie: coupleCourant,
      puissanceEntree: (coupleEntree * vitesseEntree * 2 * Math.PI) / 60,
      puissanceSortie: (coupleCourant * vitesseCourante * 2 * Math.PI) / 60,
      nombreEtages: solution.length
    };
  };

  // =========================================================================
  // ===== Résistance en flexion — Formule de Lewis =====
  // =========================================================================

  /**
   * Calcule la résistance en flexion d'une dent d'engrenage selon la
   * formule de Lewis (Wilfred Lewis, 1892).
   *
   * La formule de Lewis modélise la dent comme une poutre encastrée
   * soumise à une force tangentielle à sa pointe. La contrainte de
   * flexion à la base de la dent est :
   *
   *   sigma = Ft / (b * m * Y)
   *
   * Où :
   *   - Ft = force tangentielle = 2 * C * 1000 / d  (N)
   *   - b  = largeur de dent (mm)
   *   - m  = module (mm)
   *   - Y  = facteur de forme de Lewis = 0.154 - 0.912 / z
   *     (approximation pour profil normalisé en développante 20 deg)
   *   - d  = diamètre primitif = m * z  (mm)
   *   - C  = couple (N.m), multiplié par 1000 pour convertir en N.mm
   *
   * Le facteur de sécurité est le rapport entre la limite élastique
   * du matériau et la contrainte calculée. Un facteur >= 1.5 est
   * considéré comme acceptable.
   *
   * @param {number} nbDents - Nombre de dents de la roue
   * @param {number} mod - Module métrique (mm)
   * @param {number} largeurDent - Largeur de la dent (mm)
   * @param {number} couple - Couple appliqué (N.m)
   * @param {number} limiteElastique - Limite élastique du matériau (MPa)
   * @returns {Object} Résultat de l'analyse Lewis :
   *   - {number} facteurLewis       — facteur de forme Y
   *   - {number} forceTangentielle   — force tangentielle Ft (N)
   *   - {number} contrainteFlexion   — contrainte sigma (MPa)
   *   - {number} facteurSecurite     — rapport limiteElastique / sigma
   *   - {boolean} estValide          — vrai si facteur >= 1.5
   */
  GearMechanics.calculerResistanceLewis = function (nbDents, mod, largeurDent, couple, limiteElastique) {
    // Facteur de forme de Lewis (approximation normalisée)
    var Y = 0.154 - 0.912 / nbDents;
    // Diamètre primitif (mm)
    var diamPrimitive = mod * nbDents;
    // Force tangentielle (N) — couple en N.m converti en N.mm
    var force = (2 * couple * 1000) / diamPrimitive;
    // Contrainte de flexion à la base de la dent (MPa)
    // Max(0.01, Y) pour éviter la division par zéro avec très peu de dents
    var contrainte = force / (largeurDent * mod * Math.max(0.01, Y));
    // Facteur de sécurité en flexion
    var facteurSecurite = limiteElastique / Math.abs(contrainte);
    return {
      facteurLewis: Y, forceTangentielle: force,
      contrainteFlexion: contrainte, facteurSecurite: facteurSecurite,
      estValide: facteurSecurite >= 1.5
    };
  };

  // =========================================================================
  // ===== Rapport de conduite (continuité d'engrènement) =====
  // =========================================================================

  /**
   * Calcule le rapport de conduite (contact ratio) d'une paire d'engrenages.
   *
   * Le rapport de conduite mesure le nombre moyen de paires de dents
   * en contact simultanément. Il doit être supérieur à 1 pour garantir
   * qu'au moins une paire de dents est toujours en prise. En pratique,
   * on vise >= 1.2 pour un fonctionnement silencieux.
   *
   * Formule (géométrie en développante de cercle) :
   *
   *   epsilon = longueurAction / (pi * cos(alpha))
   *
   * Où :
   *   - longueurAction = sqrt(ra1^2 - rb1^2) + sqrt(ra2^2 - rb2^2) - (r1 + r2) * sin(alpha)
   *   - r1, r2     = rayons primitifs (= z/2 en unités module)
   *   - ra1, ra2   = rayons de tête (= r + 1 en unités module, addendum = 1 module)
   *   - rb1, rb2   = rayons de base (= r * cos(alpha))
   *   - alpha      = angle de pression (contact)
   *
   * Note : les calculs sont effectués en « unités module » (rayon = z/2)
   * car le module se simplifie dans le rapport final.
   *
   * @param {number} nbDentsMenante - Nombre de dents de la roue menante
   * @param {number} nbDentsMenee - Nombre de dents de la roue menée
   * @param {number} angleContact - Angle de pression (degrés)
   * @returns {number} Rapport de conduite (sans unité, doit être > 1)
   */
  GearMechanics.calculerRapportConduite = function (nbDentsMenante, nbDentsMenee, angleContact) {
    // Conversion de l'angle de pression en radians
    var alpha = angleContact * Math.PI / 180;
    var cosAlpha = Math.cos(alpha), sinAlpha = Math.sin(alpha);

    // Rayons primitifs (en unités module, soit z/2)
    var r1 = nbDentsMenante / 2, r2 = nbDentsMenee / 2;
    // Rayons de tête (addendum = 1 module)
    var ra1 = r1 + 1, ra2 = r2 + 1;
    // Rayons de base (projection du primitif sur la ligne d'action)
    var rb1 = r1 * cosAlpha, rb2 = r2 * cosAlpha;

    // Longueur d'action : somme des segments d'approche et de retrait,
    // moins l'entraxe projeté sur la ligne d'action
    var longueurAction = Math.sqrt(ra1 * ra1 - rb1 * rb1) + Math.sqrt(ra2 * ra2 - rb2 * rb2) - (r1 + r2) * sinAlpha;

    // Rapport de conduite = longueur d'action / pas de base
    // Pas de base = pi * cos(alpha)  (en unités module)
    return longueurAction / (Math.PI * cosAlpha);
  };

  // =========================================================================
  // ===== Vitesse périphérique =====
  // =========================================================================

  /**
   * Calcule la vitesse périphérique au cercle primitif d'un engrenage.
   *
   * Formule : V = (pi * m * z * N) / 60000
   *
   * Où :
   *   - m = module (mm)
   *   - z = nombre de dents
   *   - N = vitesse de rotation (tr/min)
   *   - 60000 = conversion mm/min -> m/s
   *
   * La vitesse périphérique est un critère important pour le choix de
   * la lubrification et la classe de qualité ISO requise.
   *
   * @param {number} nbDents - Nombre de dents de la roue
   * @param {number} mod - Module métrique (mm)
   * @param {number} vitesseRotation - Vitesse de rotation (tr/min)
   * @returns {number} Vitesse périphérique (m/s)
   */
  GearMechanics.calculerVitessePeripherique = function (nbDents, mod, vitesseRotation) {
    return (Math.PI * mod * nbDents * vitesseRotation) / 60000;
  };

  // =========================================================================
  // ===== Contrainte de contact — Formule de Hertz (ISO 6336) =====
  // =========================================================================

  /**
   * Calcule la contrainte de contact de Hertz selon la norme ISO 6336.
   *
   * La théorie de Hertz (Heinrich Hertz, 1882) modélise le contact entre
   * deux cylindres (les cercles primitifs) pour déterminer la pression
   * maximale à la surface de contact. C'est le mode de défaillance
   * complémentaire à la flexion (Lewis) : la fatigue de surface
   * (pitting, écaillage).
   *
   * Formule simplifiée ISO 6336 :
   *
   *   sigma_H = ZH * ZE * sqrt( Ft / (d1 * b) * uFactor )
   *
   * Où :
   *   - ZH = facteur de zone = sqrt(2 * cos(alpha) / sin(2*alpha))
   *     Tient compte de la géométrie du contact au point primitif
   *   - ZE = facteur d'élasticité (sqrt(MPa)), vaut 190 pour acier/acier
   *     Dépend des modules d'Young et coefficients de Poisson
   *   - Ft = force tangentielle = 2 * C * 1000 / d1  (N)
   *   - d1 = diamètre primitif de la menante (mm)
   *   - b  = largeur de dent (mm)
   *   - u  = rapport de nombre de dents B/A
   *   - uFactor = (u+1)/u pour contact externe, (u-1)/u pour contact interne
   *     Le contact interne (concave/convexe) a une contrainte plus faible
   *
   * @param {number} nbDentsA - Nombre de dents de la roue menante
   * @param {number} nbDentsB - Nombre de dents de la roue menée
   * @param {number} mod - Module métrique (mm)
   * @param {number} largeurDent - Largeur de dent (mm)
   * @param {number} couple - Couple d'entrée (N.m)
   * @param {Object} [params] - Paramètres optionnels
   * @param {number} [params.angleContact=20] - Angle de pression (degrés)
   * @param {number} [params.limiteContact=1200] - Limite de fatigue en contact (MPa)
   * @param {boolean} [params.isInternal=false] - Vrai si engrenage interne (couronne)
   * @returns {Object} Résultat de l'analyse Hertz :
   *   - {number} contrainteHertz          — contrainte sigma_H (MPa)
   *   - {number} facteurSecuriteContact   — rapport limite / sigma_H
   *   - {boolean} estValide               — vrai si facteur >= 1.0
   *   - {number} ZE                       — facteur d'élasticité utilisé
   *   - {number} ZH                       — facteur de zone calculé
   *   - {number} forceTangentielle        — force Ft (N)
   */
  GearMechanics.calculerContrainteHertz = function (nbDentsA, nbDentsB, mod, largeurDent, couple, params) {
    params = params || {};
    // Angle de pression en radians
    var alpha = (params.angleContact || 20) * Math.PI / 180;

    // Facteur d'élasticité ZE (sqrt(MPa)) — valeur pour contact acier/acier
    // Dérivé de : ZE = sqrt(1 / (pi * ((1-v1^2)/E1 + (1-v2^2)/E2)))
    var ZE = 190;

    // Diamètre primitif de la menante (mm)
    var d1 = mod * nbDentsA;

    // Rapport de denture u = B/A
    var u = nbDentsB / nbDentsA;

    // Force tangentielle (N) — couple en N.m, d1 en mm
    var Ft = (2 * couple * 1000) / d1;

    // Facteur de zone ZH — tient compte de la géométrie de contact au point primitif
    // ZH = sqrt(2 * cos(alpha) / sin(2*alpha))
    var ZH = Math.sqrt(2 * Math.cos(alpha) / Math.sin(2 * alpha));

    // Facteur de rapport des rayons de courbure :
    //   - Contact externe (engrenages classiques) : (u+1)/u
    //   - Contact interne (couronne) : (u-1)/u — plus favorable car
    //     le contact concave/convexe distribue mieux la pression
    var isInternal = params.isInternal || false;
    var uFactor = isInternal ? (u - 1) / u : (u + 1) / u;

    // Contrainte de Hertz sigma_H (MPa)
    var sigmaH = ZH * ZE * Math.sqrt(Ft / (d1 * largeurDent) * uFactor);

    // Limite de contact (MPa) — acier trempé/cémenté par défaut
    var limiteContact = params.limiteContact || 1200;
    // Facteur de sécurité en contact (doit être >= 1.0)
    var facteurSecurite = limiteContact / sigmaH;

    return {
      contrainteHertz: sigmaH,
      facteurSecuriteContact: facteurSecurite,
      estValide: facteurSecurite >= 1.0,
      ZE: ZE,
      ZH: ZH,
      forceTangentielle: Ft
    };
  };

  // =========================================================================
  // ===== Profil en développante de cercle (involute) =====
  // =========================================================================

  /**
   * Génère les points du profil en développante de cercle d'une dent.
   *
   * La développante de cercle (involute) est la courbe tracée par
   * l'extrémité d'un fil que l'on déroule d'un cylindre (le cercle de
   * base). C'est le profil standard des dents d'engrenages car il
   * garantit un rapport de vitesse constant (loi fondamentale de
   * l'engrènement).
   *
   * Équations paramétriques (paramètre t >= 0) :
   *   x(t) = rb * sqrt(1 + t^2) * cos(t - arctan(t))
   *   y(t) = rb * sqrt(1 + t^2) * sin(t - arctan(t))
   *
   * Où :
   *   - rb = rayon de base = (m * z * cos(alpha)) / 2
   *   - t varie de 0 (cercle de base) à tMax (cercle de tête)
   *   - tMax = sqrt((ra/rb)^2 - 1)
   *   - ra = rayon de tête = (m * z) / 2 + m  (addendum = 1 module)
   *
   * Les points en dehors de la plage [rayonPied, rayonTête] sont
   * exclus (le pied de dent a un profil en raccord, pas en développante).
   *
   * @param {number} nbDents - Nombre de dents de la roue
   * @param {number} mod - Module métrique (mm)
   * @param {number} angleContact - Angle de pression (degrés)
   * @param {number} [points=50] - Nombre de points à générer sur la courbe
   * @returns {Array<{x: number, y: number, r: number}>} Points du profil
   *   avec coordonnées cartésiennes (x, y) et rayon polaire (r) en mm
   */
  GearMechanics.genererProfilDeveloppante = function (nbDents, mod, angleContact, points) {
    points = points || 50;
    // Conversion de l'angle de pression en radians
    var alpha = angleContact * Math.PI / 180;

    // Rayons caractéristiques (mm)
    var rayonBase = (mod * nbDents * Math.cos(alpha)) / 2;   // Cercle de base
    var rayonTete = (mod * nbDents) / 2 + mod;                // Cercle de tête (addendum = 1m)
    var rayonPied = (mod * nbDents) / 2 - 1.25 * mod;         // Cercle de pied (dédendum = 1.25m)

    var profil = [];
    // Paramètre t maximal correspondant au rayon de tête
    var tMax = Math.sqrt(Math.pow(rayonTete / rayonBase, 2) - 1);

    for (var i = 0; i <= points; i++) {
      var t = (tMax * i) / points;
      // Rayon courant sur la développante
      var r = rayonBase * Math.sqrt(1 + t * t);
      // Exclure les points hors de la zone utile de la dent
      if (r < rayonPied || r > rayonTete) continue;
      // Angle de développante (involute function) : inv(t) = t - arctan(t)
      var involute = t - Math.atan(t);
      profil.push({ x: r * Math.cos(involute), y: r * Math.sin(involute), r: r });
    }
    return profil;
  };

  // =========================================================================
  // ===== Vérification d'interférence =====
  // =========================================================================

  /**
   * Vérifie s'il y a interférence de taillage entre deux engrenages.
   *
   * L'interférence se produit lorsque la tête d'une dent pénètre dans
   * le pied de la dent conjuguée au-delà du cercle de base. Cela
   * provoque un taillage (undercut) du pied de dent, affaiblissant
   * la résistance mécanique.
   *
   * Pour un profil normalisé avec angle de pression alpha, le nombre
   * minimal de dents sans interférence est :
   *
   *   z_min = ceil(2 / sin^2(alpha))
   *
   * Pour alpha = 20 deg : z_min = ceil(2 / sin^2(20)) = ceil(17.1) = 18
   * Pour alpha = 25 deg : z_min = ceil(2 / sin^2(25)) = ceil(11.2) = 12
   *
   * @param {number} nbDentsMenante - Nombre de dents de la roue menante
   * @param {number} nbDentsMenee - Nombre de dents de la roue menée
   * @param {number} angleContact - Angle de pression (degrés)
   * @returns {Object} Résultat de la vérification :
   *   - {boolean} interfere         — vrai si au moins une roue est en interférence
   *   - {number} nbDentsMinimal     — nombre minimal de dents sans interférence
   *   - {boolean} menanteSuffisant  — vrai si la menante a assez de dents
   *   - {boolean} meneeSuffisant    — vrai si la menée a assez de dents
   */
  GearMechanics.verifierInterference = function (nbDentsMenante, nbDentsMenee, angleContact) {
    var alpha = angleContact * Math.PI / 180;
    var sinAlpha = Math.sin(alpha);
    // Nombre minimal de dents : z_min = ceil(2 / sin^2(alpha))
    var nbDentsMin = Math.ceil(2 / (sinAlpha * sinAlpha));
    return {
      interfere: nbDentsMenante < nbDentsMin || nbDentsMenee < nbDentsMin,
      nbDentsMinimal: nbDentsMin,
      menanteSuffisant: nbDentsMenante >= nbDentsMin,
      meneeSuffisant: nbDentsMenee >= nbDentsMin
    };
  };

  // =========================================================================
  // ===== Jeu de denture (backlash) =====
  // =========================================================================

  /**
   * Calcule le jeu de denture (backlash) recommandé selon la qualité ISO.
   *
   * Le jeu de denture est l'espace libre entre les flancs non actifs
   * de deux dents en prise. Il est nécessaire pour :
   *   - Permettre la lubrification
   *   - Compenser la dilatation thermique
   *   - Éviter le coincement
   *
   * Le jeu nominal est calculé à partir d'un facteur dépendant de la
   * classe de qualité ISO 1328 (1 = très précis, 12 = grossier),
   * multiplié par le module. Les bornes min/max encadrent les
   * tolérances de fabrication (50% à 150% du nominal).
   *
   * @param {number} mod - Module métrique (mm)
   * @param {number} [qualiteISO=7] - Classe de qualité ISO 1328 (1 à 12)
   * @returns {Object} Jeu de denture :
   *   - {number} jeu        — jeu nominal (mm)
   *   - {number} qualiteISO — classe de qualité utilisée
   *   - {number} jeuMin     — jeu minimal (mm)
   *   - {number} jeuMax     — jeu maximal (mm)
   */
  GearMechanics.calculerJeuDenture = function (mod, qualiteISO) {
    qualiteISO = qualiteISO || 7;
    // Facteurs de jeu par classe ISO (index = classe, 0 non utilisé)
    var facteurs = [0, 0.01, 0.013, 0.018, 0.025, 0.035, 0.05, 0.071, 0.1, 0.14, 0.2, 0.28, 0.4];
    var facteur = facteurs[qualiteISO] || 0.071;
    // Jeu nominal = facteur * module
    var jeu = facteur * mod;
    return { jeu: jeu, qualiteISO: qualiteISO, jeuMin: jeu * 0.5, jeuMax: jeu * 1.5 };
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.core.GearMechanics = GearMechanics;

  // COMPAT : shim global pour le code hérité qui accède à window.GearMechanics
  window.GearMechanics = GearMechanics;

})(GearApp);
