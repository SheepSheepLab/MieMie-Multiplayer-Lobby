// The authenticated seat token stays in the existing local storage. This
// tab-scoped record can restore the invite without retaining the room password.
const key = 'mm-lobby-resume-guest-v1';

export function createGuestResume(storage) {
  return {
    get() {
      try {
        const saved = JSON.parse(storage?.getItem(key) ?? 'null');
        return saved?.invite && saved.profile && saved.roomId ? saved : null;
      } catch { return null; }
    },
    set(value) {
      try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Resume is optional. */ }
    },
    clear() {
      try { storage?.removeItem(key); } catch { /* The room still closes locally. */ }
    },
  };
}
