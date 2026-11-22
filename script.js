/* ==============================================================
   L'EFFET DE FRAPPE de la page d'accueil
   Modifie seulement la liste ROLES (une ligne par rôle,
   virgule à la fin de chaque ligne sauf la dernière).
   ============================================================== */

const ROLES = [
  "élève ingénieur à l'IPSA",
  "en échange en Malaisie",
  "télécoms et systèmes embarqués",
  "pilote d'avion léger"
];

const VITESSE_FRAPPE     = 65;    // ms par lettre écrite
const VITESSE_EFFACEMENT = 35;    // ms par lettre effacée
const PAUSE_FIN_DE_MOT   = 1700;  // ms d'arrêt sur un rôle complet


/* --------------------------------------------------------------
   Plomberie
   -------------------------------------------------------------- */

const sansAnimation = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const cible = document.getElementById("typing");

if (cible && ROLES.length > 0 && !sansAnimation) {
  let indexRole = 0;
  let nbLettres = ROLES[0].length;   // le premier rôle est déjà écrit dans le HTML
  let onEfface = true;

  function etape() {
    const role = ROLES[indexRole];
    if (!onEfface) {
      nbLettres++;
      cible.textContent = role.slice(0, nbLettres);
      if (nbLettres === role.length) {
        onEfface = true;
        return setTimeout(etape, PAUSE_FIN_DE_MOT);
      }
      return setTimeout(etape, VITESSE_FRAPPE);
    }
    nbLettres--;
    cible.textContent = role.slice(0, nbLettres);
    if (nbLettres === 0) {
      onEfface = false;
      indexRole = (indexRole + 1) % ROLES.length;
      return setTimeout(etape, VITESSE_FRAPPE * 3);
    }
    return setTimeout(etape, VITESSE_EFFACEMENT);
  }

  setTimeout(etape, PAUSE_FIN_DE_MOT);
}


/* Apparition en douceur des blocs au défilement */
/* Projets dépliables : la ligne ouverte remonte en haut de l'écran,
   et fermer le projet "pouls" coupe la caméra si elle est allumée. */
document.querySelectorAll("details.project").forEach(function (d) {
  d.addEventListener("toggle", function () {
    if (d.open) {
      const haut = d.getBoundingClientRect().top;
      if (haut < 70 || haut > window.innerHeight * 0.5) {
        window.scrollTo({ top: window.scrollY + haut - 84, behavior: sansAnimation ? "auto" : "smooth" });
      }
    } else if (d.id === "pouls") {
      const stop = document.getElementById("bpm-stop");
      if (stop && !stop.disabled) stop.click();
    }
  });
});

const animables = document.querySelectorAll(".tl-item, .project, .skill-card, .hobby, .section-title");

if (!sansAnimation && "IntersectionObserver" in window) {
  animables.forEach(function (el) {
    el.style.opacity = "0";
    el.style.transform = "translateY(16px)";
    el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
  });

  const observateur = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (entree) {
      if (entree.isIntersecting) {
        entree.target.style.opacity = "1";
        entree.target.style.transform = "none";
        observateur.unobserve(entree.target);
      }
    });
  }, { threshold: 0.08 });

  animables.forEach(function (el) { observateur.observe(el); });
}
