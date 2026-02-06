// main.js - Point d'entrée avec support Web Worker, arrêt et raccourcis clavier

let isSearching = false;

async function lancerRecherche() {
  if (isSearching) {
    arreterRecherche();
    return;
  }

  UI.clearLogs();

  const btn = document.getElementById("startStopBtn");
  btn.innerText = "Arrêter";
  btn.classList.add("running");
  isSearching = true;

  const progressBar = document.getElementById("progress-bar");
  progressBar.style.width = "0%";
  progressBar.style.display = "block";
  UI.afficherMessageStatus("Calcul en cours...");

  const rapport = parseFloat(document.getElementById("rapport").value);
  const dentMenanteMin = parseInt(document.getElementById("val_menante_min").innerText);
  const dentMenanteMax = parseInt(document.getElementById("val_menante_max").innerText);
  const dentMeneeMin = parseInt(document.getElementById("val_menee_min").innerText);
  const dentMeneeMax = parseInt(document.getElementById("val_menee_max").innerText);
  const precision = parseFloat(document.getElementById("precision").value);
  const maxEtages = parseInt(document.getElementById("etages").value);
  const maxSolutions = parseInt(document.getElementById("max_solutions").value);
  const maxIterations = parseInt(document.getElementById("max_iterations").value);

  // Valeurs optionnelles
  const dentMenanteFixeValue = document.getElementById("dent_menante_fixe").value;
  const dentMeneeFixeValue = document.getElementById("dent_menee_fixe").value;
  const dentMenanteFixe = dentMenanteFixeValue.trim() !== "" ? parseInt(dentMenanteFixeValue, 10) : null;
  const dentMeneeFixe = dentMeneeFixeValue.trim() !== "" ? parseInt(dentMeneeFixeValue, 10) : null;

  // Mode réduction uniquement
  const reductionOnlyEl = document.getElementById("reduction_only");
  const allowReductionOnly = reductionOnlyEl ? reductionOnlyEl.checked : true;

  // Types de transmission actifs
  const typesActifs = [];
  document.querySelectorAll('.type-checkbox:checked').forEach(cb => {
    typesActifs.push(cb.value);
  });
  if (typesActifs.length === 0) typesActifs.push('spur');

  // Validation des entrées
  if (isNaN(rapport) || rapport <= 0) {
    UI.afficherMessageStatus("Erreur : rapport cible invalide");
    _resetButton();
    return;
  }
  if (dentMenanteMin > dentMenanteMax || dentMeneeMin > dentMeneeMax) {
    UI.afficherMessageStatus("Erreur : intervalles de dents invalides");
    _resetButton();
    return;
  }

  try {
    const resultats = await Engine.rechercherEngrenages(
      dentMenanteMin, dentMenanteMax,
      dentMeneeMin, dentMeneeMax,
      rapport, maxEtages, precision,
      maxSolutions, maxIterations,
      dentMenanteFixe, dentMeneeFixe,
      allowReductionOnly,
      typesActifs
    );
    UI.afficherResultats(resultats);
    progressBar.style.width = "100%";
    UI.afficherMessageStatus(resultats.length > 0
      ? `Calcul terminé - ${resultats.length} solution(s) trouvée(s)`
      : "Aucun engrenage trouvé"
    );
  } catch (err) {
    UI.afficherMessageStatus("Erreur lors du calcul");
    console.error(err);
  }

  _resetButton();
}

function arreterRecherche() {
  Engine.arreterRecherche();
  UI.afficherMessageStatus("Recherche interrompue");
  _resetButton();
}

function _resetButton() {
  const btn = document.getElementById("startStopBtn");
  btn.innerText = "Rechercher";
  btn.classList.remove("running");
  isSearching = false;
}

// Raccourcis clavier
document.addEventListener("keydown", (e) => {
  // Ctrl+Entrée : Lancer la recherche
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    lancerRecherche();
  }
  // Échap : Arrêter la recherche
  if (e.key === "Escape" && isSearching) {
    arreterRecherche();
  }
});

// Sauvegarde et restauration des paramètres via localStorage
function sauvegarderParametres() {
  const params = {
    rapport: document.getElementById("rapport").value,
    precision: document.getElementById("precision").value,
    etages: document.getElementById("etages").value,
    max_solutions: document.getElementById("max_solutions").value,
    max_iterations: document.getElementById("max_iterations").value,
    dent_menante_fixe: document.getElementById("dent_menante_fixe").value,
    dent_menee_fixe: document.getElementById("dent_menee_fixe").value,
    module: document.getElementById("module").value,
    vitesse_entree: document.getElementById("vitesse_entree") ? document.getElementById("vitesse_entree").value : "",
    couple_entree: document.getElementById("couple_entree") ? document.getElementById("couple_entree").value : ""
  };
  localStorage.setItem("gearCalcParams", JSON.stringify(params));
  UI.ajouterLog("Paramètres sauvegardés.");
}

function restaurerParametres() {
  const saved = localStorage.getItem("gearCalcParams");
  if (!saved) return;

  try {
    const params = JSON.parse(saved);
    Object.keys(params).forEach(id => {
      const el = document.getElementById(id);
      if (el && params[id]) el.value = params[id];
    });
    UI.ajouterLog("Paramètres restaurés.");
  } catch (e) {
    console.error("Erreur restauration paramètres:", e);
  }
}

// Restauration automatique au chargement
document.addEventListener("DOMContentLoaded", () => {
  restaurerParametres();
});
