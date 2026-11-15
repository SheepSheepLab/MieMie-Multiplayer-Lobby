type ChatEvents = {
  on(name: string, callback: () => void): unknown;
  removeListener(name: string, callback: () => void): unknown;
};
type ChatContext = {
  groupId?: string | number | null;
  characterId?: string | number | null;
  characters?: Record<string | number, {name?: string} | undefined>;
  eventSource?: ChatEvents;
  eventTypes?: Record<string, string>;
};
const characterEvents = ['CHAT_CHANGED', 'CHARACTER_EDITED', 'CHARACTER_RENAMED'];
const emptySubtitle = '请打开单人角色聊天';

// Use the ecosystem's current-character label for the Tavern chat.
export function createLobbyHeader(label: HTMLElement, getContext: () => ChatContext | undefined, onChatUpdate: () => void) {
  let source: ChatEvents | undefined;
  let names: string[] = [];

  function detach() {
    for (const name of names) source?.removeListener(name, readSubtitle);
    source = undefined;
    names = [];
  }
  function readContext() {
    try { return getContext(); } catch { return undefined; }
  }
  function updateSubtitle(context: ChatContext | undefined) {
    const id = context?.characterId;
    const character = id == null || context?.groupId ? undefined : context?.characters?.[id];
    const text = character ? `当前角色：${character.name || id}` : emptySubtitle;
    if (label.textContent !== text) {
      label.textContent = text;
      label.title = text;
    }
  }

  const readSubtitle = () => {
    updateSubtitle(readContext());
    onChatUpdate();
  };
  return {
    refresh(active: boolean) {
      if (!active) { detach(); return; }
      const context = readContext();
      updateSubtitle(context);
      const nextSource = context?.eventSource;
      const nextNames = [...new Set(characterEvents.flatMap(key => context?.eventTypes?.[key] || []))];
      if (source === nextSource && names.length === nextNames.length && names.every((name, index) => name === nextNames[index])) return;
      detach();
      if (typeof nextSource?.on !== 'function' || typeof nextSource.removeListener !== 'function') return;
      source = nextSource;
      names = nextNames;
      for (const name of names) source.on(name, readSubtitle);
    },
    dispose: detach,
  };
}
