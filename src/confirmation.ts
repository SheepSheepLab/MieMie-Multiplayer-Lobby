type Question = {title: string; description: string; confirm: string; danger?: boolean};

export function createLobbyConfirmation(doc: Document) {
  const dialog = doc.createElement('dialog');
  dialog.className = 'mm-lobby mm-confirmation';
  dialog.setAttribute('aria-labelledby', 'mm-confirm-title');
  dialog.setAttribute('aria-describedby', 'mm-confirm-description');
  dialog.innerHTML = `
    <div class="mm-confirm-card">
      <h2 id="mm-confirm-title"></h2>
      <p id="mm-confirm-description"></p>
      <div class="mm-confirm-buttons">
        <button type="button" data-confirm-cancel>取消</button>
        <button type="button" data-confirm-accept class="primary"></button>
      </div>
    </div>`;
  doc.body.append(dialog);
  const title = dialog.querySelector<HTMLElement>('#mm-confirm-title')!;
  const description = dialog.querySelector<HTMLElement>('#mm-confirm-description')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')!;
  const accept = dialog.querySelector<HTMLButtonElement>('[data-confirm-accept]')!;
  let complete: ((accepted: boolean) => void) | undefined;
  let origin: HTMLElement | undefined;

  function resolve(accepted: boolean) {
    const finish = complete;
    if (!finish) return false;
    complete = undefined;
    dialog.close();
    if (origin?.isConnected) origin.focus({preventScroll: true});
    origin = undefined;
    finish(accepted);
    return true;
  }
  cancel.addEventListener('click', () => resolve(false));
  accept.addEventListener('click', () => resolve(true));
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    resolve(false);
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) resolve(false);
  });

  return {
    ask(question: Question, trigger?: HTMLElement) {
      if (dialog.open) return Promise.resolve(false);
      title.textContent = question.title;
      description.textContent = question.description;
      accept.textContent = question.confirm;
      accept.classList.toggle('danger', !!question.danger);
      origin = trigger;
      dialog.showModal();
      cancel.focus({preventScroll: true});
      return new Promise<boolean>(finish => { complete = finish; });
    },
    cancel: () => resolve(false),
    dispose() {
      resolve(false);
      dialog.remove();
    },
  };
}
