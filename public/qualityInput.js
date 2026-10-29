// Keep the edited input alive: native steppers need the same node across clicks.
export function bindQualityInput(input, { apply, fallback, increaseButton, decreaseButton }) {
  input.addEventListener('input', () => {
    if (!input.value.trim()) return;
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 1 && value <= 100) apply(value);
  });
  input.addEventListener('change', () => {
    const number = input.value.trim() ? Number(input.value) : NaN;
    const quality = Number.isFinite(number) ? Math.max(1, Math.min(100, Math.round(number))) : fallback();
    if (input.value !== String(quality)) input.value = String(quality);
    apply(quality);
  });
  for (const [button, delta] of [[increaseButton, 1], [decreaseButton, -1]]) {
    if (!button) continue;
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const current = input.value.trim() ? Number(input.value) : NaN;
      const value = Number.isFinite(current) ? current : fallback();
      input.value = String(Math.max(1, Math.min(100, Math.round(value) + delta)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}
