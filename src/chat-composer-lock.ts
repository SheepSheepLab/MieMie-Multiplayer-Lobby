const nativeButtons = '#send_but, #option_regenerate, #option_continue, #mes_continue, #mes_impersonate, .swipe_right';

export function createChatComposerLock(doc: Document) {
  let input: HTMLTextAreaElement | null = null;
  let originalReadOnly = false;
  const note = doc.createElement('p');
  note.className = 'mm-lobby-send-note';
  note.setAttribute('role', 'status');
  note.textContent = '联机对话 · 请通过回合行动球提交';
  const stop = (event: Event) => {
    if (!input) return;
    const target = event.target as Element | null;
    const form = input.closest('#send_form');
    const blocked = (event.type === 'click' && target?.closest(nativeButtons))
      || (event.type === 'submit' && target === form)
      || (event.type === 'keydown' && target === input && (event as KeyboardEvent).key === 'Enter');
    if (blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  for (const name of ['click', 'submit', 'keydown']) doc.addEventListener(name, stop, true);

  function sync(locked: boolean) {
    const next = locked ? doc.querySelector<HTMLTextAreaElement>('#send_textarea') : null;
    if (next === input) return;
    if (input) input.readOnly = originalReadOnly;
    note.remove();
    input = next;
    if (input) {
      originalReadOnly = input.readOnly;
      input.readOnly = true;
      const form = input.closest('#send_form');
      if (form) form.before(note);
      else input.before(note);
    }
  }

  return {sync, dispose() {
    sync(false);
    for (const name of ['click', 'submit', 'keydown']) doc.removeEventListener(name, stop, true);
  }};
}
