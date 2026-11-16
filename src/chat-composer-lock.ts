const nativeButtons = '#send_but, #option_regenerate, #option_continue, #mes_continue, #mes_impersonate, .swipe_left, .swipe_right, .mes_img_swipe_left, .mes_img_swipe_right, .mes_create_branch, .mes_create_bookmark, #option_new_bookmark';
const swipePickerControls = '.swipes-counter, .mes_swipe_picker';

export function createChatComposerLock(doc: Document) {
  let input: HTMLTextAreaElement | null = null;
  let originalReadOnly = false;
  const note = doc.createElement('p');
  note.className = 'mm-lobby-send-note';
  note.setAttribute('role', 'status');
  note.textContent = '联机对话 · 行动、重 Roll 与分支请使用回合行动球';
  const stop = (event: Event) => {
    if (!input) return;
    const target = event.target && 'closest' in event.target ? event.target as Element : null;
    const form = input.closest('#send_form');
    const key = event.type === 'keydown' ? (event as KeyboardEvent).key : '';
    const shortcut = ['ArrowLeft', 'ArrowRight'].includes(key) && !target?.closest('input, textarea, select, [contenteditable], .mm-lobby');
    const opensSwipePicker = target?.closest(swipePickerControls) &&
      (['click', 'touchstart', 'contextmenu'].includes(event.type) || [' ', 'Enter'].includes(key));
    const blocked = opensSwipePicker || (event.type === 'click' && target?.closest(nativeButtons))
      || (event.type === 'submit' && target === form)
      || (target === input && key === 'Enter') || shortcut;
    if (blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const events = ['click', 'submit', 'keydown', 'touchstart', 'contextmenu'];
  for (const name of events) doc.addEventListener(name, stop, {capture:true,passive:false});

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
    for (const name of events) doc.removeEventListener(name, stop, true);
  }};
}
