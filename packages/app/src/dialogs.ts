export function closeDialogOnDataAction(dialog: HTMLDialogElement, dataAttribute: string): void {
  dialog.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset[dataAttribute] !== undefined) dialog.close();
  });
}

export function showDialogError(form: HTMLFormElement, selector: string, error: unknown): void {
  const label = form.querySelector<HTMLElement>(selector);
  if (!label) return;
  label.hidden = false;
  label.textContent = error instanceof Error ? error.message : String(error);
}
