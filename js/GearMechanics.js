// GearMechanics.js - Module de calculs d'ingénierie mécanique avancés
// Supporte tous les types de transmission définis dans TransmissionTypes.js

class GearMechanics {

  /**
   * Calcule les propriétés mécaniques complètes d'un train de transmission.
   * Chaque étage peut être d'un type différent.
   * @param {Array} solution - [[A1, B1, typeId?], [A2, B2, typeId?], ...]
   * @param {Object} params - Paramètres globaux
   */
  static analyserTrainEngrenages(solution, params = {}) {
    const mod = params.module || 2;
    const vitesseEntree = params.vitesseEntree || 1500;
    const coupleEntree = params.coupleEntree || 10;
    const angleContact = params.angleContact || 20;
    const largeurDent = params.largeurDent || (10 * mod);
    const limiteElastique = params.limiteElastique || 250;

    const etages = [];
    let vitesseCourante = vitesseEntree;
    let coupleCourant = coupleEntree;
    let rendementTotal = 1;
    let rapportTotal = 1;
    let sensRotationTotal = 1;

    for (let i = 0; i < solution.length; i++) {
      const stageData = solution[i];
      const A = stageData[0];
      const B = stageData[1];
      const typeId = stageData[2] || 'spur';
      const type = getTransmissionType(typeId);

      // Rapport de l'étage selon le type
      const rapport = type.calculerRapport(A, B);
      rapportTotal *= rapport;

      // Géométrie spécifique au type
      const geometrie = type.calculerGeometrie(A, B, mod, { angleContact, ...params });

      // Rendement spécifique au type
      const rendementEtage = type.calculerRendement(A, B, {
        angleContact, coeffFrottement: params.coeffFrottement, module: mod,
        angleHelice: params.angleHelice, typeCourroie: params.typeCourroie,
        nbSatellites: params.nbSatellites
      });
      rendementTotal *= rendementEtage;

      // Sens de rotation
      const sensEtage = type.sensRotation(A, B, params);
      sensRotationTotal *= sensEtage;

      // Vitesse et couple
      const vitesseSortie = vitesseCourante / rapport;
      const coupleSortie = coupleCourant * rapport * rendementEtage;

      // Puissance
      const puissanceEntree = (coupleCourant * vitesseCourante * 2 * Math.PI) / 60;
      const puissanceSortie = puissanceEntree * rendementEtage;
      const pertePuissance = puissanceEntree - puissanceSortie;

      // Résistance des dents (applicable seulement aux engrenages)
      let resistanceMenante = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      let resistanceMenee = { facteurSecurite: Infinity, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
      let rapportConduite = null;
      let vitessePeripherique = 0;

      if (typeId !== 'belt') {
        if (typeId === 'worm') {
          // Pour la vis sans fin, seulement la roue a des dents classiques
          resistanceMenee = this.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
          resistanceMenante = { facteurSecurite: 3.0, estValide: true, contrainteFlexion: 0, forceTangentielle: 0, facteurLewis: 0 };
        } else if (typeId === 'epicyclic') {
          const dentsSat = (B - A) / 2;
          resistanceMenante = this.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = this.calculerResistanceLewis(Math.max(6, dentsSat), mod, largeurDent, coupleSortie / 3, limiteElastique);
        } else {
          resistanceMenante = this.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
          resistanceMenee = this.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);
        }

        if (typeId === 'spur' || typeId === 'helical') {
          rapportConduite = this.calculerRapportConduite(A, B, angleContact);
        }

        vitessePeripherique = this.calculerVitessePeripherique(A, mod, vitesseCourante);
      }

      etages.push({
        index: i,
        typeId: typeId,
        typeNom: type.nom,
        typeNomCourt: type.nomCourt,
        typeIcone: type.icone,
        axesRelation: type.axesRelation,
        reversible: type.reversible !== false,
        dentsMenante: A,
        dentsMenee: B,
        labelA: type.labelA,
        labelB: type.labelB,
        uniteA: type.uniteA,
        uniteB: type.uniteB,
        rapport: rapport,
        geometrie: geometrie,
        rendement: rendementEtage,
        sensRotation: sensEtage,
        vitesseEntree: vitesseCourante,
        vitesseSortie: vitesseSortie,
        coupleEntree: coupleCourant,
        coupleSortie: coupleSortie,
        puissanceEntree: puissanceEntree,
        puissanceSortie: puissanceSortie,
        pertePuissance: pertePuissance,
        resistanceMenante: resistanceMenante,
        resistanceMenee: resistanceMenee,
        rapportConduite: rapportConduite,
        vitessePeripherique: vitessePeripherique
      });

      vitesseCourante = vitesseSortie;
      coupleCourant = coupleSortie;
    }

    return {
      etages: etages,
      rapportTotal: rapportTotal,
      rendementTotal: rendementTotal,
      sensRotationTotal: sensRotationTotal,
      vitesseEntree: vitesseEntree,
      vitesseSortie: vitesseCourante,
      coupleEntree: coupleEntree,
      coupleSortie: coupleCourant,
      puissanceEntree: (coupleEntree * vitesseEntree * 2 * Math.PI) / 60,
      puissanceSortie: (coupleCourant * vitesseCourante * 2 * Math.PI) / 60,
      nombreEtages: solution.length
    };
  }

  /**
   * Calcule la résistance des dents selon Lewis.
   */
  static calculerResistanceLewis(nbDents, mod, largeurDent, couple, limiteElastique) {
    const Y = 0.154 - 0.912 / nbDents;
    const diamPrimitive = mod * nbDents;
    const force = (2 * couple * 1000) / diamPrimitive;
    const contrainte = force / (largeurDent * mod * Math.max(0.01, Y));
    const facteurSecurite = limiteElastique / Math.abs(contrainte);
    return {
      facteurLewis: Y,
      forceTangentielle: force,
      contrainteFlexion: contrainte,
      facteurSecurite: facteurSecurite,
      estValide: facteurSecurite >= 1.5
    };
  }

  /**
   * Calcule le rapport de conduite.
   */
  static calculerRapportConduite(nbDentsMenante, nbDentsMenee, angleContact) {
    const alpha = angleContact * Math.PI / 180;
    const cosAlpha = Math.cos(alpha);
    const sinAlpha = Math.sin(alpha);
    const r1 = nbDentsMenante / 2;
    const r2 = nbDentsMenee / 2;
    const ra1 = r1 + 1;
    const ra2 = r2 + 1;
    const rb1 = r1 * cosAlpha;
    const rb2 = r2 * cosAlpha;
    const longueurAction = Math.sqrt(ra1 * ra1 - rb1 * rb1) + Math.sqrt(ra2 * ra2 - rb2 * rb2) - (r1 + r2) * sinAlpha;
    const pasBase = Math.PI * cosAlpha;
    return longueurAction / pasBase;
  }

  static calculerVitessePeripherique(nbDents, mod, vitesseRotation) {
    const diamPrimitive = mod * nbDents;
    return (Math.PI * diamPrimitive * vitesseRotation) / 60000;
  }

  static genererProfilDeveloppante(nbDents, mod, angleContact, points = 50) {
    const alpha = angleContact * Math.PI / 180;
    const rayonBase = (mod * nbDents * Math.cos(alpha)) / 2;
    const rayonTete = (mod * nbDents) / 2 + mod;
    const rayonPied = (mod * nbDents) / 2 - 1.25 * mod;
    const profil = [];
    const tMax = Math.sqrt((rayonTete / rayonBase) ** 2 - 1);
    for (let i = 0; i <= points; i++) {
      const t = (tMax * i) / points;
      const r = rayonBase * Math.sqrt(1 + t * t);
      if (r < rayonPied || r > rayonTete) continue;
      const involute = t - Math.atan(t);
      profil.push({ x: r * Math.cos(involute), y: r * Math.sin(involute), r: r });
    }
    return profil;
  }

  static verifierInterference(nbDentsMenante, nbDentsMenee, angleContact) {
    const alpha = angleContact * Math.PI / 180;
    const sinAlpha = Math.sin(alpha);
    const nbDentsMin = Math.ceil(2 / (sinAlpha * sinAlpha));
    return {
      interfere: nbDentsMenante < nbDentsMin || nbDentsMenee < nbDentsMin,
      nbDentsMinimal: nbDentsMin,
      menanteSuffisant: nbDentsMenante >= nbDentsMin,
      meneeSuffisant: nbDentsMenee >= nbDentsMin
    };
  }

  static calculerJeuDenture(mod, qualiteISO = 7) {
    const facteurQualite = [0, 0.01, 0.013, 0.018, 0.025, 0.035, 0.05, 0.071, 0.1, 0.14, 0.2, 0.28, 0.4];
    const facteur = facteurQualite[qualiteISO] || 0.071;
    const jeu = facteur * mod;
    return { jeu, qualiteISO, jeuMin: jeu * 0.5, jeuMax: jeu * 1.5 };
  }
}

window.GearMechanics = GearMechanics;
