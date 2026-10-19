/* Detalles de interfaz: brillo del hero que sigue al puntero (solo con mouse y sin "reducir movimiento") */
(function(){
  const hero = document.querySelector("#scr-home .hero");
  if (!hero || !matchMedia("(hover:hover)").matches || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  hero.addEventListener("pointermove", e => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    hero.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  });
})();
