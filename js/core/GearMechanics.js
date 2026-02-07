// GearMechanics.js - Calculs d'ingénierie mécanique avancés
// Supporte tous les types de transmission via le registry

(function (GearApp) {

  var GearMechanics = {};

  /**
   * Analyse complète d'un train de transmission multi-types.
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

    for (var i = 0; i < solution.length; i++) {
      var stageData = solution[i];
      var A = stageData[0];
      var B = stageData[1];
      var typeId = stageData[2] || 'spur';
      var type = registry.get(typeId);

      var rapport = type.calculerRapport(A, B);
      rapportTotal *= rapport;

      var geometrie = type.calculerGeometrie(A, B, mod, { angleContact: angleContact });
      var rendementEtage = type.calculerRendement(A, B, {
        angleContact: angleContact, coeffFrottement: params.coeffFrottement, module: mod,
        angleHelice: params.angleHelice, typeCourroie: params.typeCourroie,
        nbSatellites: params.nbSatellites
      });
      rendementTotal *= rendementEtage;

      var sensEtage = type.sensRotation(A, B, params);
      sensRotationTotal *= sensEtage;

      var vitesseSortie = vitesseCourante / rapport;
      var coupleSortie = coupleCourant * rapport * rendementEtage;
      var puissanceEntree = (coupleCourant * vitesseCourante * 2 * Math.PI) / 60;
      var puissanceSortie = puissanceEntree * rendementEtage;
      var pertePuissance = puissanceEntree - puissanceSortie;

      var resistanceMenante = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      var resistanceMenee = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      var hertzContact = null;
      var rapportConduite = null;
      var vitessePeripherique = 0;

      if (typeId !== 'belt') {
        if (typeId === 'worm') {
          resistanceMenee = GearMechanics.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
          resistanceMenante = { facteurSecurite: 3.0, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
        } else if (typeId === 'epicyclic') {
          var dentsSat = (B - A) / 2;
          var nbSat = params.nbSatellites || 3;
          resistanceMenante = GearMechanics.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = GearMechanics.calculerResistanceLewis(Math.max(6, dentsSat), mod, largeurDent, coupleSortie / nbSat, limiteElastique);
        } else {
          resistanceMenante = GearMechanics.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = GearMechanics.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
        }
        // Contrainte de Hertz (contact) pour les engrenages cylindriques
        if (typeId === 'spur' || typeId === 'helical' || typeId === 'bevel' || typeId === 'internal') {
          hertzContact = GearMechanics.calculerContrainteHertz(A, B, mod, largeurDent, coupleCourant, {
            angleContact: angleContact,
            limiteContact: params.limiteContact
          });
        }
        if (typeId === 'spur' || typeId === 'helical') {
          rapportConduite = GearMechanics.calculerRapportConduite(A, B, angleContact);
        }
        vitessePeripherique = GearMechanics.calculerVitessePeripherique(A, mod, vitesseCourante);
      }

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

      vitesseCourante = vitesseSortie;
      coupleCourant = coupleSortie;
    }

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

  GearMechanics.calculerResistanceLewis = function (nbDents, mod, largeurDent, couple, limiteElastique) {
    var Y = 0.154 - 0.912 / nbDents;
    var diamPrimitive = mod * nbDents;
    var force = (2 * couple * 1000) / diamPrimitive;
    var contrainte = force / (largeurDent * mod * Math.max(0.01, Y));
    var facteurSecurite = limiteElastique / Math.abs(contrainte);
    return {
      facteurLewis: Y, forceTangentielle: force,
      contrainteFlexion: contrainte, facteurSecurite: facteurSecurite,
      estValide: facteurSecurite >= 1.5
    };
  };

  GearMechanics.calculerRapportConduite = function (nbDentsMenante, nbDentsMenee, angleContact) {
    var alpha = angleContact * Math.PI / 180;
    var cosAlpha = Math.cos(alpha), sinAlpha = Math.sin(alpha);
    var r1 = nbDentsMenante / 2, r2 = nbDentsMenee / 2;
    var ra1 = r1 + 1, ra2 = r2 + 1;
    var rb1 = r1 * cosAlpha, rb2 = r2 * cosAlpha;
    var longueurAction = Math.sqrt(ra1 * ra1 - rb1 * rb1) + Math.sqrt(ra2 * ra2 - rb2 * rb2) - (r1 + r2) * sinAlpha;
    return longueurAction / (Math.PI * cosAlpha);
  };

  GearMechanics.calculerVitessePeripherique = function (nbDents, mod, vitesseRotation) {
    return (Math.PI * mod * nbDents * vitesseRotation) / 60000;
  };

  /**
   * Calcul de la contrainte de Hertz (contact) selon ISO 6336.
   * Complète l'analyse Lewis (flexion) pour une évaluation résistance complète.
   */
  GearMechanics.calculerContrainteHertz = function (nbDentsA, nbDentsB, mod, largeurDent, couple, params) {
    params = params || {};
    var alpha = (params.angleContact || 20) * Math.PI / 180;
    var ZE = 190; // facteur d'élasticité (√MPa) — acier/acier
    var d1 = mod * nbDentsA;
    var u = nbDentsB / nbDentsA;

    // Force tangentielle (N) — couple en N·m, d1 en mm
    var Ft = (2 * couple * 1000) / d1;

    // Facteur de zone ZH
    var ZH = Math.sqrt(2 * Math.cos(alpha) / Math.sin(2 * alpha));

    // Contrainte de Hertz σH
    var sigmaH = ZH * ZE * Math.sqrt(Ft / (d1 * largeurDent) * (u + 1) / u);

    // Limite de contact (MPa) — acier trempé par défaut
    var limiteContact = params.limiteContact || 1200;
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

  GearMechanics.genererProfilDeveloppante = function (nbDents, mod, angleContact, points) {
    points = points || 50;
    var alpha = angleContact * Math.PI / 180;
    var rayonBase = (mod * nbDents * Math.cos(alpha)) / 2;
    var rayonTete = (mod * nbDents) / 2 + mod;
    var rayonPied = (mod * nbDents) / 2 - 1.25 * mod;
    var profil = [];
    var tMax = Math.sqrt(Math.pow(rayonTete / rayonBase, 2) - 1);
    for (var i = 0; i <= points; i++) {
      var t = (tMax * i) / points;
      var r = rayonBase * Math.sqrt(1 + t * t);
      if (r < rayonPied || r > rayonTete) continue;
      var involute = t - Math.atan(t);
      profil.push({ x: r * Math.cos(involute), y: r * Math.sin(involute), r: r });
    }
    return profil;
  };

  GearMechanics.verifierInterference = function (nbDentsMenante, nbDentsMenee, angleContact) {
    var alpha = angleContact * Math.PI / 180;
    var sinAlpha = Math.sin(alpha);
    var nbDentsMin = Math.ceil(2 / (sinAlpha * sinAlpha));
    return {
      interfere: nbDentsMenante < nbDentsMin || nbDentsMenee < nbDentsMin,
      nbDentsMinimal: nbDentsMin,
      menanteSuffisant: nbDentsMenante >= nbDentsMin,
      meneeSuffisant: nbDentsMenee >= nbDentsMin
    };
  };

  GearMechanics.calculerJeuDenture = function (mod, qualiteISO) {
    qualiteISO = qualiteISO || 7;
    var facteurs = [0, 0.01, 0.013, 0.018, 0.025, 0.035, 0.05, 0.071, 0.1, 0.14, 0.2, 0.28, 0.4];
    var facteur = facteurs[qualiteISO] || 0.071;
    var jeu = facteur * mod;
    return { jeu: jeu, qualiteISO: qualiteISO, jeuMin: jeu * 0.5, jeuMax: jeu * 1.5 };
  };

  GearApp.core.GearMechanics = GearMechanics;

  // COMPAT : shim global
  window.GearMechanics = GearMechanics;

})(GearApp);
