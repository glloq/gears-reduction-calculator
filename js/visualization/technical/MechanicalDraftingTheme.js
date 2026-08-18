// MechanicalDraftingTheme.js - Comment un dessinateur mécanique le représente.
//
// Le modèle sait maintenant CE QUI EXISTE (MechanicalGraph), OÙ cela existe
// (SpatialLayout) et D'OÙ on le regarde (ProjectionEngine). Il manquait la
// dernière question, et c'est elle qui fait la différence entre un diagramme
// et un dessin : avec quel TRAIT chaque chose se dessine.
//
// La réponse était dispersée. Trois renderers déclaraient chacun leurs
// épaisseurs — quarante-cinq `stroke-width` écrits à la main — et chacun
// reconstruisait pour l'export une feuille de style à lui. Rien ne garantissait
// qu'un axe ait la même allure dans deux vues du même mécanisme, ni qu'une cote
// se distingue d'un contour ailleurs que par l'habitude de celui qui l'a
// écrite.
//
// Ici, un RÔLE. Le dessin dit « ceci est une ligne d'axe » ; le thème décide à
// quoi ressemble une ligne d'axe. Les rôles et la hiérarchie de traits
// s'inspirent des conventions du dessin mécanique — ISO 128 pour les types de
// traits, ISO 2203 pour les engrenages — sans prétendre les certifier : aucune
// convention n'est ici vérifiée une à une contre la norme.
//
// Deux STYLES, et ce n'est pas une palette :
//
//   visuel     ce que l'application montre depuis toujours — denture réelle,
//              couleurs de rôle, animation ;
//   technique  le vocabulaire du dessin d'ensemble — hiérarchie de traits,
//              axes, surfaces primitives, très peu de couleur.
//
// Passer de l'un à l'autre ne change JAMAIS la mécanique : ni un rapport, ni
// un entraxe, ni l'identité d'un organe. Seul le langage graphique change.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearDraftingTheme = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * La hiérarchie de traits. ISO 128-20 construit les épaisseurs sur un rapport
   * de 2 entre trait fin et trait fort ; on garde ce rapport, à l'échelle du
   * dessin (les vues sont en millimètres réels, un trait de 0,35 mm y est
   * effectivement fin).
   */
  var WIDTH = { narrow: 0.35, medium: 0.5, wide: 0.7 };

  /**
   * Les motifs de tirets, nommés par ce qu'ils DISENT et non par leur aspect.
   * `null` = trait continu.
   */
  var DASH = {
    solid: null,
    dashed: '4 2',              // ce qui existe mais n'est pas vu
    chain: '12 3 2 3',          // axe : mixte fin, un point entre deux tirets
    fine: '3 2',                // construction
    phantom: '10 3 2 3 2 3'     // contour voisin, position extrême
  };

  /**
   * Les rôles. `line` donne le trait, `ink` le jeton de couleur à utiliser en
   * style technique — presque toujours l'encre — et `visual` ce que le style
   * visuel garde de l'apparence historique.
   *
   * `aliases` recense les classes déjà émises par les primitives : elles
   * portaient le rôle sans le nommer, et le nommer permet de vérifier qu'un
   * axe est un axe dans les trois vues.
   */
  var ROLES = {
    visibleContour: { line: { width: WIDTH.medium, dash: DASH.solid }, ink: 'ink',
      aliases: ['tooth-profile', 'gear-profile', 'pulley-profile', 'ring-profile-top',
        'ring-profile-bottom', 'worm-body', 'cone-body', 'cone-face', 'oblique-body',
        'rack-teeth', 'rack-profile', 'geometry-member', 'worm-end'] },
    visibleContourStrong: { line: { width: WIDTH.wide, dash: DASH.solid }, ink: 'ink',
      aliases: ['belt-line', 'chain-line', 'shaft-body'] },
    hiddenContour: { line: { width: WIDTH.narrow, dash: DASH.dashed }, ink: 'muted',
      aliases: ['hidden-contour'] },

    centerLine: { line: { width: WIDTH.narrow, dash: DASH.chain }, ink: 'muted',
      aliases: ['shaft-centre', 'shaft-axis', 'construction-axis', 'stage-axis', 'cone-apex'] },

    pitchSurface: { line: { width: WIDTH.narrow, dash: DASH.chain }, ink: 'muted',
      aliases: ['pitch-circle', 'pitch-line', 'pitch-diameter'] },
    rootSurface: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'muted',
      aliases: ['root-circle', 'root-line', 'ring-rim', 'cone-front'] },
    baseSurface: { line: { width: WIDTH.narrow, dash: DASH.fine }, ink: 'muted',
      aliases: ['base-circle'] },

    constructionLine: { line: { width: WIDTH.narrow, dash: DASH.fine }, ink: 'muted',
      aliases: ['construction-circle', 'tip-circle', 'outside-diameter', 'bore-line',
        'pulley-flange', 'hub-cross', 'line-of-action', 'cone-tip', 'cone-teeth'] },

    dimensionLine: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'muted',
      aliases: ['dimension-line'] },
    extensionLine: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'muted',
      aliases: ['dimension-witness', 'dim-leader'] },
    dimensionText: { line: null, ink: 'muted', font: 3.2,
      aliases: ['geometry-dimension', 'train-dim'] },

    leaderLine: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'muted',
      aliases: ['label-leader', 'leader-line'] },

    cuttingPlane: { line: { width: WIDTH.wide, dash: DASH.chain }, ink: 'ink',
      aliases: ['cutting-plane'] },
    sectionHatch: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'muted',
      aliases: ['section-hatch'] },

    groundSymbol: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'warning',
      aliases: ['ground-boundary', 'ground-hatch'] },

    motionArrow: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'accent',
      aliases: ['spin-mark', 'rotation-arrow'] },
    powerFlow: { line: { width: WIDTH.medium, dash: DASH.solid }, ink: 'accent',
      aliases: ['power-flow', 'io-arrow'] },

    warning: { line: { width: WIDTH.medium, dash: DASH.solid }, ink: 'danger',
      aliases: ['mechanical-warning'] },

    partMark: { line: { width: WIDTH.narrow, dash: DASH.solid }, ink: 'ink', font: 3.4,
      aliases: ['part-mark'] }
  };

  var STYLES = ['visual', 'technical'];

  function role(name) { return ROLES[name] || null; }

  /** La classe canonique d'un rôle : `d-center-line` pour `centerLine`. */
  function className(name) {
    if (!ROLES[name]) return null;
    return 'd-' + name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
  }

  /** Le rôle que porte une classe déjà émise, ou null si elle n'en porte aucun. */
  function roleOf(cssClass) {
    var found = null;
    Object.keys(ROLES).forEach(function (name) {
      if (found) return;
      if (className(name) === cssClass) { found = name; return; }
      if ((ROLES[name].aliases || []).indexOf(cssClass) >= 0) found = name;
    });
    return found;
  }

  /** Tous les sélecteurs qui portent un rôle : sa classe et ses alias. */
  function selectors(name) {
    var spec = ROLES[name];
    if (!spec) return [];
    return ['.' + className(name)].concat((spec.aliases || []).map(function (alias) { return '.' + alias; }));
  }

  var DEFAULT_TOKENS = { ink: '#182335', muted: '#5d6b81', accent: '#2563eb',
    success: '#0c7f5c', danger: '#b3261e', warning: '#b26a00', surface: '#ffffff' };

  /**
   * Le style TECHNIQUE ramène presque tout à l'encre : la couleur y est une
   * information rare, pas une décoration. Le style VISUEL garde les couleurs de
   * rôle que l'application utilise depuis toujours.
   */
  function inkOf(name, style, tokens) {
    var spec = ROLES[name];
    if (!spec) return tokens.ink;
    if (style !== 'technical') return tokens[spec.ink] || tokens.ink;
    // En technique, seuls le bâti et les alertes gardent une couleur : ce sont
    // les deux seules choses qu'on ne doit pas manquer sur un plan.
    if (spec.ink === 'warning' || spec.ink === 'danger') return tokens[spec.ink];
    return spec.ink === 'muted' ? tokens.muted : tokens.ink;
  }

  /** Les déclarations d'un rôle, prêtes à être écrites en CSS. */
  function declarations(name, style, tokens) {
    var spec = ROLES[name];
    if (!spec) return '';
    tokens = Object.assign({}, DEFAULT_TOKENS, tokens || {});
    var out = [];
    if (spec.line) {
      out.push('stroke:' + inkOf(name, style, tokens));
      out.push('stroke-width:' + spec.line.width);
      if (spec.line.dash) out.push('stroke-dasharray:' + spec.line.dash);
    } else {
      out.push('fill:' + inkOf(name, style, tokens));
    }
    if (spec.font) out.push('font-size:' + spec.font + 'px');
    return out.join(';');
  }

  /**
   * La feuille de style d'un dessin, pour un style donné.
   *
   * Elle sert à l'export : un SVG exporté ne peut pas emporter les variables
   * CSS de la page, et chaque renderer en reconstruisait une version à lui —
   * trois copies, donc trois dérives possibles.
   */
  function css(options) {
    options = options || {};
    var style = options.style === 'technical' ? 'technical' : 'visual';
    var tokens = Object.assign({}, DEFAULT_TOKENS, options.tokens || {});
    var rules = Object.keys(ROLES).map(function (name) {
      return selectors(name).join(',') + '{' + declarations(name, style, tokens) + '}';
    });
    // Les remplissages ne sont pas un rôle de TRAIT : en technique, une pièce
    // n'est pas coloriée, elle est cernée. En visuel, on garde les teintes de
    // rôle qui rendent l'entrée et la sortie repérables d'un coup d'œil.
    if (style === 'technical') {
      rules.push('.tooth-profile,.gear-profile,.pulley-profile,.ring-profile-top,' +
        '.ring-profile-bottom,.worm-body,.cone-body,.cone-face,.oblique-body,' +
        '.rack-teeth,.geometry-member,.worm-end{fill:none}');
      rules.push('.gear-hub,.carrier-hub{fill:' + tokens.surface + ';stroke:' + tokens.ink + ';stroke-width:' + WIDTH.narrow + '}');
    } else {
      rules.push('.tooth-profile,.gear-profile,.pulley-profile,.ring-profile-top,' +
        '.ring-profile-bottom,.oblique-body{fill:' + tokens.accent + '22}');
      rules.push('.output-member .tooth-profile,.output-member .gear-profile{fill:' + tokens.success + '22}');
      rules.push('.gear-hub,.carrier-hub{fill:' + tokens.surface + ';stroke:' + tokens.ink + ';stroke-width:0.5}');
    }
    rules.push('svg{background:' + tokens.surface + '}');
    return rules.join('');
  }

  /** Les jetons de couleur de la page, ou les valeurs de repli hors navigateur. */
  function tokensFrom(element) {
    if (typeof getComputedStyle !== 'function' || !element) return Object.assign({}, DEFAULT_TOKENS);
    var computed = getComputedStyle(element);
    function read(name, fallback) {
      var value = computed.getPropertyValue(name);
      return (value && value.trim()) || fallback;
    }
    return { ink: read('--ink', DEFAULT_TOKENS.ink), muted: read('--muted', DEFAULT_TOKENS.muted),
      accent: read('--accent', DEFAULT_TOKENS.accent), success: read('--success', DEFAULT_TOKENS.success),
      danger: read('--danger', DEFAULT_TOKENS.danger), warning: read('--warning', DEFAULT_TOKENS.warning),
      surface: read('--surface-1', DEFAULT_TOKENS.surface) };
  }

  return { ROLES: ROLES, STYLES: STYLES, WIDTH: WIDTH, DASH: DASH, DEFAULT_TOKENS: DEFAULT_TOKENS,
    role: role, className: className, roleOf: roleOf, selectors: selectors,
    declarations: declarations, css: css, tokensFrom: tokensFrom };
});
