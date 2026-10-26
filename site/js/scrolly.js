// Shared scrollytelling helpers.
//
// A scrolly section looks like this:
//   <section class="view scrolly" data-view="...">
//     <div class="scrolly-stage"> ...chart... </div>
//     <div class="steps">
//       <div class="step"><div>...text...</div></div>
//       ...
//     </div>
//   </section>
//
// The stage is sticky while the steps scroll past it. The step closest to the
// middle of the screen is "active"; watchSteps() reports its index so the
// view can change its chart.

export function watchSteps(section, onStep) {
  const steps = [...section.querySelectorAll(".step")];
  let current = -1;
  const setActive = (i) => {
    if (i === current) return;
    current = i;
    steps.forEach((s, j) => s.classList.toggle("is-active", j === i));
    onStep(i);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) setActive(steps.indexOf(e.target));
    });
  }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
  steps.forEach((s) => io.observe(s));
  setActive(0);
  return io;
}

// Fill <span data-val="key"> placeholders with numbers computed from the data.
export function fillValues(section, values) {
  section.querySelectorAll("[data-val]").forEach((node) => {
    const v = values[node.dataset.val];
    if (v !== undefined) node.textContent = v;
  });
}
