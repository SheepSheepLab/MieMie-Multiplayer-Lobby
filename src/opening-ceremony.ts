export function createOpeningCeremony(host: Window, icon: string) {
  const doc = host.document;
  let dialog: HTMLDialogElement | null = null;
  let previousFocus: HTMLElement | null = null;
  let focusFallback: (() => HTMLElement | null) | undefined;

  const syncVisibility = () => dialog?.toggleAttribute('data-paused', doc.hidden);

  function close(restoreFocus = true) {
    if (!dialog) return;
    const current = dialog;
    const previous = previousFocus;
    const fallback = focusFallback;
    dialog = previousFocus = null;
    focusFallback = undefined;
    doc.removeEventListener('visibilitychange', syncVisibility);
    current.close();
    current.remove();
    if (!restoreFocus) return;
    if (previous?.isConnected && !previous.closest('[hidden], [inert]')) {
      previous.focus({ preventScroll: true });
      if (doc.activeElement === previous) return;
    }
    fallback?.()?.focus({ preventScroll: true });
  }

  function show(fallback?: () => HTMLElement | null) {
    if (dialog) return;
    previousFocus = doc.activeElement?.nodeType === 1 ? doc.activeElement as HTMLElement : null;
    focusFallback = fallback;
    const current = doc.createElement('dialog');
    current.className = 'mm-opening';
    current.setAttribute('aria-label', '故事正式开始');
    current.innerHTML = `<div class="mm-opening-card"><div class="mm-opening-ring"><img src="${icon}" alt=""><i></i><i></i></div>${Array.from({ length: 16 }, (_, i) => `<span class="mm-opening-spark" style="--i:${i};--x:${(i * 37) % 100}%"></span>`).join('')}<small>YOUR PARTY IS READY</small><h1>故事，正式开始</h1><p>同一个世界，各自的命运。</p><div class="mm-opening-line"></div><button type="button" autofocus>踏入故事</button></div>`;
    current.addEventListener('cancel', event => event.preventDefault());
    current.addEventListener('keydown', event => {
      if (event.key === 'Tab') event.preventDefault();
      if (event.key === 'Escape') event.stopPropagation();
    });
    current.querySelector('button')!.addEventListener('click', () => close());
    doc.body.append(current);
    dialog = current;
    current.showModal();
    doc.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
  }

  return { show, close, isOpen: () => dialog !== null, dispose: () => close(false) };
}
