// iOS-style range sliders: the track is filled up to the thumb. Browsers cannot style the filled
// part in CSS alone, so every <input type="range"> gets a --p custom property (0..100%) kept in sync
// on input and on React-driven value changes.

function sync(el: HTMLInputElement) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const p = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--p", `${Math.max(0, Math.min(100, p)).toFixed(2)}%`);
}

export function installSliderFill(): () => void {
  const all = () => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(sync);
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.type === "range") sync(t);
  };
  document.addEventListener("input", onInput, true);
  const mo = new MutationObserver(all);
  mo.observe(document.body, { childList: true, subtree: true });
  const id = setInterval(all, 400); // programmatic value changes (React) fire no input event
  all();
  return () => {
    document.removeEventListener("input", onInput, true);
    mo.disconnect();
    clearInterval(id);
  };
}
