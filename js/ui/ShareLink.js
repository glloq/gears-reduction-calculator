// ShareLink.js - Une adresse qui porte le dessin qu'on est en train de montrer.
//
// « Regarde cette solution » ne s'envoyait pas. Le lien de partage existant
// datait de l'ancien formulaire : il recopiait des valeurs de champs, si bien
// qu'il rouvrait une RECHERCHE — au destinataire de la relancer, d'attendre, et
// de retrouver lui-même, dans quatre-vingts lignes, celle dont on lui parlait.
// Entre-temps le moteur avait pu changer d'avis.
//
// Un lien porte donc quatre choses, et dans cet ordre d'importance :
//
//   1. LA SOLUTION, littéralement — la suite d'étages qui la définit. C'est
//      elle qu'on montre, et elle se rouvre sans rien relancer ;
//   2. LE CAHIER DES CHARGES, pour que le destinataire puisse reprendre la
//      recherche là où elle en était, et non deviner ce qu'on cherchait ;
//   3. LE POINT DE VUE — quelle vue, quel regard, éclaté ou non. Un lien qui
//      rouvre sur une autre vue ne montre pas ce qu'on montrait ;
//   4. L'ÉTAGE regardé, s'il y en avait un.
//
// CE QUI EST LISIBLE, ET CE QUI NE L'EST PAS. Le point de vue tient dans des
// paramètres nommés : on voit ce qu'un lien va ouvrir avant de le suivre, et on
// peut le modifier à la main. La solution et le cahier des charges sont des
// objets structurés : ils voyagent en base64, faute de quoi l'adresse
// deviendrait illisible pour tout le monde, humains compris.
//
// LA TAILLE. Une session complète pèse près de deux mille caractères, dont les
// neuf dixièmes sont des VALEURS D'USINE que le destinataire possède déjà. Le
// lien ne porte donc que ce qui a été DÉCIDÉ : la différence avec une session
// neuve. Cela suppose que les deux bouts partagent les mêmes valeurs par
// défaut — c'est le rôle du numéro de version, qu'il faut incrémenter dès
// qu'elles changent de sens. Le risque est d'ailleurs contenu : la solution,
// elle, voyage en entier, et c'est d'elle que viennent le dessin et les
// chiffres ; le cahier des charges ne sert qu'à relancer une recherche.
//
// Module pur : ni DOM, ni `location`. Il transforme un état en chaîne de
// requête et l'inverse ; c'est l'application qui sait d'où vient cet état et
// quelle page il faut ouvrir.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.GearShareLink = api;
    if (root.GearApp) { root.GearApp.ui = root.GearApp.ui || {}; root.GearApp.ui.ShareLink = api; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Version du format. À incrémenter dès que le sens d'un champ change, ou que
   * les valeurs par défaut d'une session changent — un lien plus ancien serait
   * alors relu avec d'autres implicites, et dirait autre chose que ce qu'il
   * disait. Un lien d'une version inconnue est REFUSÉ, jamais deviné.
   */
  var VERSION = 1;

  /** Les noms de paramètres, tels qu'ils apparaissent dans l'adresse. */
  var KEYS = { version: 'v', view: 'vue', projection: 'oeil', explode: 'eclate',
    stage: 'etage', solution: 'sol', brief: 'cdc' };

  /**
   * Ce qu'une étape RECALCULE, et qui n'a donc rien à faire dans un lien. La
   * géométrie d'un étage se déduit de ses dentures et de ses paramètres : la
   * transporter tripleraît la longueur de l'adresse pour rien, et pire, un lien
   * ancien rouvrirait une géométrie périmée à côté d'un moteur à jour.
   */
  var DERIVED = ['geometry', 'mechanical', 'forces', 'materials', 'warnings', 'ratio', 'efficiency'];

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // ===== Ne porter que ce qui a été décidé =====

  /**
   * prune(value, reference) → ce qui DIFFÈRE de la référence, et rien d'autre.
   *
   * `undefined` veut dire « identique à la référence » : la clé disparaît. Un
   * objet est parcouru clé par clé ; une liste est comparée d'un bloc et
   * transportée entière dès qu'elle diffère — un diff par indice tiendrait dans
   * moins de place mais deviendrait faux au premier élément inséré.
   */
  function prune(value, reference) {
    if (same(value, reference)) return undefined;
    if (!isObject(value) || !isObject(reference)) return clone(value);
    var out = {}, kept = 0;
    Object.keys(value).forEach(function (key) {
      var slice = prune(value[key], reference[key]);
      if (slice !== undefined) { out[key] = slice; kept++; }
    });
    return kept ? out : undefined;
  }

  /**
   * graft(value, reference) → la référence, corrigée de ce que le lien porte.
   *
   * L'inverse exact de `prune` tant que les deux bouts partagent la même
   * référence. Ce qui n'est pas mentionné garde sa valeur d'usine — c'est la
   * raison pour laquelle le lien est court, et la raison pour laquelle il faut
   * une version.
   */
  function graft(value, reference) {
    if (value === undefined) return clone(reference);
    if (!isObject(value) || !isObject(reference)) return clone(value);
    var out = clone(reference) || {};
    Object.keys(value).forEach(function (key) { out[key] = graft(value[key], reference[key]); });
    return out;
  }

  /** Une solution réduite à CE QUI LA DÉFINIT : ses étages, sans leurs calculs. */
  function bareStages(stages) {
    return (stages || []).map(function (stage) {
      var copy = clone(stage) || {};
      DERIVED.forEach(function (key) { delete copy[key]; });
      return copy;
    });
  }

  // ===== base64url, des deux côtés du fil =====

  /**
   * UN TEXTE, OCTET PAR OCTET. `btoa` ne connaît que le latin-1 : lui donner
   * directement un « é » lui ferait perdre le caractère, ou lever. Le texte
   * passe donc d'abord en octets UTF-8 — un caractère par octet, valeurs 0 à
   * 255 — ce que `btoa` sait encoder.
   */
  function utf8Bytes(text) {
    return encodeURIComponent(String(text)).replace(/%([0-9A-F]{2})/g, function (whole, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }

  function fromUtf8Bytes(bytes) {
    return decodeURIComponent(Array.prototype.map.call(String(bytes), function (character) {
      return '%' + ('00' + character.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }

  function toBase64(text) {
    var raw = typeof Buffer !== 'undefined'
      ? Buffer.from(text, 'utf8').toString('base64') : btoa(utf8Bytes(text));
    return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64(text) {
    var raw = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (raw.length % 4) raw += '=';
    if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'base64').toString('utf8');
    return fromUtf8Bytes(atob(raw));
  }

  function pack(value) { return value === undefined || value === null ? null : toBase64(JSON.stringify(value)); }
  function unpack(text) {
    if (!text) return null;
    // Une adresse se recopie à la main, se coupe en fin de ligne, se fait
    // manger un caractère par un client de messagerie. Un morceau illisible ne
    // doit pas emporter le reste du lien avec lui.
    try { return JSON.parse(fromBase64(text)); } catch (ignore) { return null; }
  }

  // ===== L'adresse =====

  /**
   * Un nombre, ou null. `null` et la chaîne vide ne sont PAS des nombres :
   * `Number(null)` vaut zéro, ce qui ferait d'« aucun étage désigné » l'étage
   * numéro un.
   */
  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * encode(state, defaults) → la chaîne de requête, sans le « ? ».
   *
   * @param {Object} state {solution, session, view}
   * @param {Object} [defaults] la session neuve qui sert de référence
   */
  function encode(state, defaults) {
    var input = state || {};
    var view = input.view || {};
    var pairs = [[KEYS.version, String(VERSION)]];

    if (view.view) pairs.push([KEYS.view, view.view]);
    if (view.projection) pairs.push([KEYS.projection, view.projection]);
    if (view.explode) pairs.push([KEYS.explode, '1']);
    // L'étage se compte À PARTIR DE 1 dans l'adresse : elle se lit, et « le
    // troisième étage » n'est pas « etage=2 » pour qui la relit.
    var stage = finite(view.stage);
    if (stage !== null && stage >= 0) pairs.push([KEYS.stage, String(Math.round(stage) + 1)]);

    if (input.solution && input.solution.stages && input.solution.stages.length) {
      pairs.push([KEYS.solution, pack({
        stages: bareStages(input.solution.stages),
        target: finite(input.solution.target),
        inputSpeedRpm: finite(input.solution.inputSpeedRpm),
        inputTorqueNm: finite(input.solution.inputTorqueNm)
      })]);
    }
    if (input.session) {
      var brief = defaults ? prune(input.session, defaults) : input.session;
      if (brief !== undefined) pairs.push([KEYS.brief, pack(brief)]);
    }
    return pairs.map(function (pair) {
      return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
    }).join('&');
  }

  /** Les paramètres d'une chaîne de requête, sans dépendre d'URLSearchParams. */
  function parse(search) {
    var out = {};
    String(search || '').replace(/^[?#]/, '').split('&').forEach(function (chunk) {
      if (!chunk) return;
      var cut = chunk.indexOf('=');
      var key = cut < 0 ? chunk : chunk.slice(0, cut);
      var value = cut < 0 ? '' : chunk.slice(cut + 1);
      try { out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' ')); }
      catch (ignore) { /* un paramètre illisible n'emporte pas les autres */ }
    });
    return out;
  }

  /**
   * decode(search, defaults) → l'état porté par l'adresse, ou null.
   *
   * Null veut dire « cette adresse ne partage rien » : aucune version, ou une
   * version qu'on ne sait pas relire. Deviner reviendrait à rouvrir une
   * solution en lui prêtant des implicites qui ne sont plus les siens.
   */
  function decode(search, defaults) {
    var query = parse(search);
    if (!query[KEYS.version]) return null;
    if (Number(query[KEYS.version]) !== VERSION) return null;

    var solution = unpack(query[KEYS.solution]);
    var brief = query[KEYS.brief] ? unpack(query[KEYS.brief]) : undefined;
    var stage = finite(query[KEYS.stage]);
    return {
      version: VERSION,
      solution: solution && solution.stages && solution.stages.length ? {
        stages: solution.stages,
        target: finite(solution.target),
        inputSpeedRpm: finite(solution.inputSpeedRpm),
        inputTorqueNm: finite(solution.inputTorqueNm)
      } : null,
      // Un cahier des charges absent n'est pas un cahier des charges vide : le
      // lien ne dit alors rien du besoin, et l'application garde le sien.
      session: brief === undefined || brief === null ? null
        : (defaults ? graft(brief, defaults) : brief),
      view: {
        view: query[KEYS.view] || null,
        projection: query[KEYS.projection] || null,
        explode: query[KEYS.explode] === '1',
        stage: stage !== null && stage >= 1 ? Math.round(stage) - 1 : null
      }
    };
  }

  /** Y a-t-il un lien de partage dans cette adresse ? Sans rien en décoder. */
  function carries(search) {
    var query = parse(search);
    return !!query[KEYS.version];
  }

  return { encode: encode, decode: decode, carries: carries, prune: prune, graft: graft,
    bareStages: bareStages, parse: parse, utf8Bytes: utf8Bytes, fromUtf8Bytes: fromUtf8Bytes,
    VERSION: VERSION, KEYS: KEYS };
});
