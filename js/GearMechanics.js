// GearMechanics.js - Module de calculs d'ingénierie mécanique avancés
// Fournit les calculs de couple, vitesse, rendement, résistance et géométrie

class GearMechanics {

  /**
   * Calcule les propriétés mécaniques complètes d'un train d'engrenages.
   * @param {Array} solution - Tableau de paires [[A1,B1], [A2,B2], ...]
   * @param {Object} params - Paramètres d'entrée
   * @param {number} params.module - Module des engrenages (mm)
   * @param {number} params.vitesseEntree - Vitesse de rotation d'entrée (tr/min)
   * @param {number} params.coupleEntree - Couple d'entrée (N.m)
   * @param {number} params.angleContact - Angle de pression (degrés, défaut 20°)
   * @param {number} params.largeurDent - Largeur de dent (mm, défaut 10*module)
   * @param {number} params.limiteElastique - Limite élastique du matériau (MPa, défaut 250)
   * @returns {Object} Propriétés mécaniques complètes
   */
  static analyserTrainEngrenages(solution, params = {}) {
    const mod = params.module || 2;
    const vitesseEntree = params.vitesseEntree || 1500; // tr/min
    const coupleEntree = params.coupleEntree || 10; // N.m
    const angleContact = params.angleContact || 20; // degrés
    const largeurDent = params.largeurDent || (10 * mod); // mm
    const limiteElastique = params.limiteElastique || 250; // MPa (acier doux)

    const etages = [];
    let vitesseCourante = vitesseEntree;
    let coupleCourant = coupleEntree;
    let rendementTotal = 1;
    let rapportTotal = 1;

    for (let i = 0; i < solution.length; i++) {
      const [A, B] = solution[i];
      const rapport = B / A;
      rapportTotal *= rapport;

      // Géométrie de l'étage
      const geometrie = this.calculerGeometrie(A, B, mod, angleContact);

      // Rendement de l'étage (formule approximative de Merritt)
      const rendementEtage = this.calculerRendement(A, B, angleContact);
      rendementTotal *= rendementEtage;

      // Vitesse et couple après cet étage
      const vitesseSortie = vitesseCourante / rapport;
      const coupleSortie = coupleCourant * rapport * rendementEtage;

      // Puissance
      const puissanceEntree = (coupleCourant * vitesseCourante * 2 * Math.PI) / 60; // Watts
      const puissanceSortie = puissanceEntree * rendementEtage;
      const pertePuissance = puissanceEntree - puissanceSortie;

      // Résistance des dents (formule de Lewis simplifiée)
      const resistanceMenante = this.calculerResistanceLewis(A, mod, largeurDent, coupleCourant, limiteElastique);
      const resistanceMenee = this.calculerResistanceLewis(B, mod, largeurDent, coupleSortie, limiteElastique);

      // Rapport de conduite (contact ratio)
      const rapportConduite = this.calculerRapportConduite(A, B, angleContact);

      // Vitesse en bout de dent
      const vitessePeripherique = this.calculerVitessePeripherique(A, mod, vitesseCourante);

      etages.push({
        index: i,
        dentsMenante: A,
        dentsMenee: B,
        rapport: rapport,
        geometrie: geometrie,
        rendement: rendementEtage,
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
   * Calcule la géométrie complète d'une paire d'engrenages.
   */
  static calculerGeometrie(nbDentsMenante, nbDentsMenee, mod, angleContact) {
    const alpha = angleContact * Math.PI / 180;

    const diamPrimitiveMenante = mod * nbDentsMenante;
    const diamPrimitiveMenee = mod * nbDentsMenee;
    const entraxe = (diamPrimitiveMenante + diamPrimitiveMenee) / 2;

    const addendum = mod; // Saillie
    const dedendum = 1.25 * mod; // Creux

    const diamTeteMenante = diamPrimitiveMenante + 2 * addendum;
    const diamTeteMenee = diamPrimitiveMenee + 2 * addendum;
    const diamPiedMenante = diamPrimitiveMenante - 2 * dedendum;
    const diamPiedMenee = diamPrimitiveMenee - 2 * dedendum;
    const diamBaseMenante = diamPrimitiveMenante * Math.cos(alpha);
    const diamBaseMenee = diamPrimitiveMenee * Math.cos(alpha);

    const pas = Math.PI * mod;
    const epaisseurDent = pas / 2;

    return {
      module: mod,
      angleContact: angleContact,
      pas: pas,
      epaisseurDent: epaisseurDent,
      entraxe: entraxe,
      menante: {
        nbDents: nbDentsMenante,
        diamPrimitive: diamPrimitiveMenante,
        diamTete: diamTeteMenante,
        diamPied: diamPiedMenante,
        diamBase: diamBaseMenante
      },
      menee: {
        nbDents: nbDentsMenee,
        diamPrimitive: diamPrimitiveMenee,
        diamTete: diamTeteMenee,
        diamPied: diamPiedMenee,
        diamBase: diamBaseMenee
      }
    };
  }

  /**
   * Calcule le rendement d'un étage d'engrenages (formule de Merritt).
   * Prend en compte le coefficient de frottement et le nombre de dents.
   */
  static calculerRendement(nbDentsMenante, nbDentsMenee, angleContact, coeffFrottement = 0.05) {
    const alpha = angleContact * Math.PI / 180;
    const pertes = (Math.PI * coeffFrottement * (1 / nbDentsMenante + 1 / nbDentsMenee)) / Math.cos(alpha);
    return Math.max(0.85, 1 - pertes); // Plancher à 85%
  }

  /**
   * Calcule la résistance des dents selon la formule de Lewis simplifiée.
   * @returns {Object} { contrainte, facteurSecurite, estValide }
   */
  static calculerResistanceLewis(nbDents, mod, largeurDent, couple, limiteElastique) {
    // Facteur de forme de Lewis (approximation)
    const Y = 0.154 - 0.912 / nbDents;
    const diamPrimitive = mod * nbDents;
    const force = (2 * couple * 1000) / diamPrimitive; // Force tangentielle en N

    // Contrainte de flexion en pied de dent (MPa)
    const contrainte = force / (largeurDent * mod * Y);
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
   * Calcule le rapport de conduite (contact ratio).
   * Un rapport > 1 garantit qu'au moins une dent est toujours en contact.
   */
  static calculerRapportConduite(nbDentsMenante, nbDentsMenee, angleContact) {
    const alpha = angleContact * Math.PI / 180;
    const cosAlpha = Math.cos(alpha);
    const sinAlpha = Math.sin(alpha);

    // Rayons primitifs
    const r1 = nbDentsMenante / 2;
    const r2 = nbDentsMenee / 2;

    // Rayons de tête (addendum = 1 module, normalisé par module)
    const ra1 = r1 + 1;
    const ra2 = r2 + 1;

    // Rayons de base
    const rb1 = r1 * cosAlpha;
    const rb2 = r2 * cosAlpha;

    // Longueur d'action
    const longueurAction =
      Math.sqrt(ra1 * ra1 - rb1 * rb1) +
      Math.sqrt(ra2 * ra2 - rb2 * rb2) -
      (r1 + r2) * sinAlpha;

    // Pas de base
    const pasBase = Math.PI * cosAlpha;

    return longueurAction / pasBase;
  }

  /**
   * Calcule la vitesse périphérique en bout de dent.
   */
  static calculerVitessePeripherique(nbDents, mod, vitesseRotation) {
    const diamPrimitive = mod * nbDents;
    // v = π × D × N / 60000 (m/s)
    return (Math.PI * diamPrimitive * vitesseRotation) / 60000;
  }

  /**
   * Génère le profil en développante de cercle pour une dent d'engrenage.
   * @param {number} nbDents - Nombre de dents
   * @param {number} mod - Module
   * @param {number} angleContact - Angle de pression (degrés)
   * @param {number} points - Nombre de points du profil
   * @returns {Array} Tableau de points [{x, y}] pour un flanc de dent
   */
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
      profil.push({
        x: r * Math.cos(involute),
        y: r * Math.sin(involute),
        r: r
      });
    }

    return profil;
  }

  /**
   * Vérifie l'interférence de taillage.
   * @returns {Object} { interfere, nbDentsMinimal }
   */
  static verifierInterference(nbDentsMenante, nbDentsMenee, angleContact) {
    const alpha = angleContact * Math.PI / 180;
    const sinAlpha = Math.sin(alpha);

    // Nombre minimum de dents pour éviter l'interférence
    const nbDentsMin = Math.ceil(2 / (sinAlpha * sinAlpha));

    return {
      interfere: nbDentsMenante < nbDentsMin || nbDentsMenee < nbDentsMin,
      nbDentsMinimal: nbDentsMin,
      menanteSuffisant: nbDentsMenante >= nbDentsMin,
      meneeSuffisant: nbDentsMenee >= nbDentsMin
    };
  }

  /**
   * Calcule le jeu de denture (backlash) recommandé.
   */
  static calculerJeuDenture(mod, qualiteISO = 7) {
    // Jeu recommandé selon la qualité ISO (approximation)
    const facteurQualite = [0, 0.01, 0.013, 0.018, 0.025, 0.035, 0.05, 0.071, 0.1, 0.14, 0.2, 0.28, 0.4];
    const facteur = facteurQualite[qualiteISO] || 0.071;
    const jeu = facteur * mod;
    return {
      jeu: jeu,
      qualiteISO: qualiteISO,
      jeuMin: jeu * 0.5,
      jeuMax: jeu * 1.5
    };
  }
}

window.GearMechanics = GearMechanics;
