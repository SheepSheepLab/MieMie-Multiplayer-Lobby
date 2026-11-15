import manifest from '../../manifest.json';
import {createMultiplayerLobbyNativeLauncher, type NativeLauncher} from './native-launcher';
import type {LauncherAppearance} from './launcher-appearance';

type Lease = {isCurrent(): boolean};
type Source = {ok: boolean; error?: string; ready: Promise<{ok: boolean; error?: string}>; release(): Promise<void>};
type HubApi = {
  signal: AbortSignal;
  attachPanel(panel: HTMLElement, options: {icon: string}): boolean;
  showPanel(lease: Lease): unknown;
  closePanel(lease: Lease): unknown;
  registerBackHandler(handler: (request: Lease) => boolean): boolean;
  registerNativeWindow(provider: {
    mount(context: {open(): unknown; signal: AbortSignal}): {getOrigin(): HTMLButtonElement | null; dispose(): void};
    open(lease: Lease): void;
    release(lease: Lease): void;
  }): boolean;
  onCleanup(cleanup: () => void): void;
};
type HubSession = {activate(): void; open(lease: Lease): unknown; deactivate(): void};
type Hub = {
  apiVersion: number;
  whenDisposed: Promise<void>;
  extensions: {
    provide(metadata: typeof manifest, factory: (api: HubApi) => HubSession): Source;
    open(id: string): Promise<unknown>;
    get(id: string): {enabled: boolean} | null;
  };
};
type Host = Window & typeof globalThis & {__MieMieHub?: Hub};
type Connection = {hub: Hub; source?: Source; suspend?(): void};
type Route = {kind: 'surface' | 'native'; close(): unknown; origin?(): HTMLElement | null};
const stopKey = 'miemie_multiplayer_lobby_hub_stopped_v1';
const foregroundSelector = '#miemie-hub-shell[data-hub-foreground="true"]';

export function startLobbyPresentation({
  host, panel, icon, appearance, dismissLayer, resetLayers, onChange, onStop, onError,
}: {
  host: Host; panel: HTMLElement; icon: string; appearance: LauncherAppearance;
  dismissLayer(): boolean; resetLayers(): void; onChange(): void; onStop(): void; onError(error: unknown): void;
}) {
  const doc = host.document;
  let stopped = false, active = false, hubForeground = false, pausedByHub = false;
  try {pausedByHub = host.localStorage.getItem(stopKey) === 'true';} catch { /* Session-only if storage is unavailable. */ }
  let route: Route | undefined;
  let standalone: NativeLauncher | undefined;
  let connection: Connection | undefined;
  let queue = Promise.resolve();
  const retired = new WeakSet<Hub>();

  function currentHub() {
    const hub = host.__MieMieHub;
    return hub?.apiVersion === manifest.apiVersion && typeof hub.extensions?.provide === 'function' && !retired.has(hub) ? hub : undefined;
  }
  function syncForeground() {
    const next = !!doc.querySelector(foregroundSelector);
    if (hubForeground === next) return;
    hubForeground = next;
    if (next && route?.kind === 'native') {
      resetLayers();
      nativeWindow?.release();
    }
    hideMainOrb(nativeWindow, next);
    onChange();
  }
  // Hub's foreground takes precedence over independent windows promoted to the browser top layer.
  function hideMainOrb(launcher: NativeLauncher | undefined, hidden: boolean) {
    const orb = launcher?.getOrigin();
    if (orb) orb.hidden = hidden;
  }
  const observer = new host.MutationObserver(records => {
    syncForeground();
    if (route?.kind === 'surface' && panel.hidden && records.some(record => record.target === panel)) {
      route = undefined;
      resetLayers();
      onChange();
    }
  });
  function watchHubShell() {
    observer.disconnect();
    observer.observe(panel, {attributes: true, attributeFilter: ['hidden']});
    const shell = doc.getElementById('miemie-hub-shell');
    if (shell) observer.observe(shell, {attributes: true, attributeFilter: ['data-hub-foreground']});
    syncForeground();
  }

  let nativeWindow: NativeLauncher | undefined;
  function createMainLauncher(mode: 'standalone' | 'native', open: () => unknown) {
    const launcher = createMultiplayerLobbyNativeLauncher({host, icon, mode, appearance, open, requestBack: back, onError});
    launcher.getOrigin()!.dataset.lobbyMain = '';
    hideMainOrb(launcher, hubForeground);
    return launcher;
  }
  function setActive(value: boolean) {
    active = value;
    onChange();
  }
  function back() {
    if (!dismissLayer()) return route?.close();
    return true;
  }
  function setHubStopped(value: boolean) {
    pausedByHub = value;
    try {
      if (value) host.localStorage.setItem(stopKey, 'true');
      else host.localStorage.removeItem(stopKey);
    } catch { /* Session-only if storage is unavailable. */ }
  }
  function mountStandalone() {
    if (standalone || pausedByHub) return;
    panel.dataset.presentation = 'native';
    const launcher = createMainLauncher('standalone', () => {
      if (stopped || standalone !== launcher) return false;
      return launcher.show(panel, () => !stopped && standalone === launcher).then(opened => {
        onChange();
        return opened;
      });
    });
    standalone = launcher;
    route = {kind: 'native', close: () => launcher.close(panel).then(result => {onChange();return result;}), origin: launcher.getOrigin};
    setActive(true);
  }
  function attach(hub: Hub) {
    const next: Connection = {hub};
    connection = next;
    standalone?.dispose();
    standalone = undefined;
    route = undefined;
    resetLayers();
    setActive(false);

    const source = hub.extensions.provide({...manifest, icon}, api => {
      let ended = false, nativeLease: Lease | undefined;
      const valid = () => !stopped && !ended && !api.signal.aborted && connection === next && currentHub() === hub;
      const suspend = () => {
        if (ended) return;
        ended = true;
        api.signal.removeEventListener('abort', suspend);
        if (next.suspend !== suspend) return;
        next.suspend = undefined;
        route = undefined;
        nativeWindow?.dispose();
        nativeWindow = undefined;
        resetLayers();
        setActive(false);
        // Hub shutdown revokes leases before it emits hub-disposed. A user stop
        // on a still-current Hub also stops networking and the generation hooks.
        void Promise.resolve().then(() => {
          if (!stopped && connection === next && currentHub() === hub && !next.suspend) {
            setHubStopped(true);
            onStop();
          }
        }).catch(onError);
      };
      next.suspend = suspend;
      api.signal.addEventListener('abort', suspend, {once: true});
      api.onCleanup(suspend);
      if (api.signal.aborted) suspend();
      return {
        activate() {
          if (!valid()) return;
          panel.dataset.presentation = 'hub';
          if (!api.attachPanel(panel, {icon})) throw Error('Hub 无法挂载联机大厅');
          api.registerBackHandler(request => request.isCurrent() && valid() && dismissLayer());
          api.registerNativeWindow({
            mount({open, signal}) {
              if (!valid() || signal.aborted) throw Error('联机大厅悬浮球已停用');
              const launcher = createMainLauncher('native', () => valid() && !signal.aborted && open());
              nativeWindow = launcher;
              return {getOrigin: launcher.getOrigin, dispose() {
                launcher.dispose();
                if (nativeWindow === launcher) nativeWindow = undefined;
              }};
            },
            open(lease) {
              const launcher = nativeWindow;
              if (!launcher || !valid() || !lease.isCurrent()) return;
              const current = () => valid() && lease.isCurrent() && nativeLease === lease && nativeWindow === launcher;
              if (nativeLease !== lease) {
                resetLayers();
                nativeLease = lease;
                panel.dataset.presentation = 'native';
              }
              route = {kind: 'native', close: () => launcher.close(panel, current).then(result => {onChange();return result;}), origin: launcher.getOrigin};
              void launcher.show(panel, current).then(onChange, onError);
            },
            release(lease) {
              if (nativeLease !== lease) return;
              nativeLease = undefined;
              route = undefined;
              nativeWindow?.release();
              resetLayers();
            },
          });
          setHubStopped(false);
          setActive(true);
        },
        open(lease) {
          if (!valid() || !lease?.isCurrent()) return false;
          route = {kind: 'surface', close: () => valid() && lease.isCurrent() && api.closePanel(lease)};
          panel.dataset.presentation = 'hub';
          return Promise.resolve(api.showPanel(lease)).then(opened => {if(valid()&&lease.isCurrent())onChange();return opened;});
        },
        deactivate: suspend,
      };
    });
    if (!source.ok) throw Error(source.error || '咩咩 Hub 拒绝注册联机大厅');
    next.source = source;
    // Don't hold the handoff queue on activation: detach must revoke the source
    // even if a Hub gets replaced during its activation.
    void source.ready.then(result => {
      if (stopped || connection !== next || currentHub() !== hub) return;
      if (!result.ok) onError(Error(result.error || '联机大厅未能启用'));
      else if (!hub.extensions.get(manifest.id)?.enabled) {
        setHubStopped(true);
        onStop();
      }
    }, onError);
  }
  async function reconcile() {
    const old = connection;
    if (old && (stopped || old.hub !== currentHub())) {
      old.suspend?.();
      connection = undefined;
        try {await old.source?.release();}
      finally {if (host.__MieMieHub !== old.hub) await old.hub.whenDisposed;}
    }
    if (stopped) return;
    const hub = currentHub();
    if (hub) {
      if (!connection) attach(hub);
    } else {
      mountStandalone();
    }
  }
  function schedule() {
    queue = queue.then(reconcile).catch(onError);
    return queue;
  }
  function ready() {
    watchHubShell();
    void schedule();
  }
  function gone(event: Event) {
    const hub = (event as CustomEvent<Hub>).detail;
    if (hub) retired.add(hub);
    ready();
  }

  host.addEventListener('miemie:hub-ready', ready);
  host.addEventListener('miemie:hub-disposed', gone);
  void Promise.resolve().then(() => {if (!stopped) ready();});
  return {
    open() {
      if (stopped) return false;
      const hub = currentHub();
      if (hub) return hub.extensions.open(manifest.id);
      return standalone?.show(panel, () => !stopped && !currentHub()).then(result => {onChange();return result;});
    },
    back,
    close: () => route?.close(),
    origin: () => route?.origin?.() ?? null,
    isSurface: () => route?.kind === 'surface' && hubForeground,
    canUseTools: () => active && !hubForeground,
    isActive: () => active && !stopped,
    dispose() {
      if (stopped) return queue;
      stopped = true;
      observer.disconnect();
      host.removeEventListener('miemie:hub-ready', ready);
      host.removeEventListener('miemie:hub-disposed', gone);
      standalone?.dispose();
      standalone = undefined;
      connection?.suspend?.();
      return schedule();
    },
  };
}
