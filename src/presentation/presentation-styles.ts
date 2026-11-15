// Adapted for Multiplayer Lobby from Preset Manager 1.0.0; attribution retained below.
// Copyright (C) 2026 SheepSheepLab
// Adapted from MieMie Polisher 1.2.1 native-launcher.css
// (commit 5a0a5cf9f4ac7cf5dbb9dac0134d307ad1caa9d1), GPL-3.0-or-later.
export const nativeLauncherStyles = `
[data-miemie-multiplayer-lobby-native]{--mm-native-motion-hero:760ms;--mm-native-blur-hero:14px;--mm-native-hero-backdrop:#05213ab8;--mm-native-ease-hero:cubic-bezier(.4,0,.2,1);--mm-native-motion-open:520ms;--mm-native-motion-close:460ms;--mm-native-ease-surface:cubic-bezier(.32,.72,0,1);--mm-native-safe-top:env(safe-area-inset-top,0px);--mm-native-safe-bottom:env(safe-area-inset-bottom,0px);--mm-native-safe-left:env(safe-area-inset-left,0px);--mm-native-safe-right:env(safe-area-inset-right,0px);display:grid;place-items:center;min-width:0;min-height:0;box-sizing:border-box;overflow:hidden;border-radius:50%;border:1px solid #c5a66b;background:#07121d;box-shadow:0 4px 16px #0009,0 0 12px #c5a66b44;padding:0!important;margin:0!important;cursor:grab;z-index:2147483300;color:#eee3ca;font:14px system-ui;touch-action:none;user-select:none;-webkit-user-select:none;transition:scale .16s,box-shadow .16s;text-shadow:none}
[data-miemie-multiplayer-lobby-native][hidden]{display:none!important}
[data-miemie-multiplayer-lobby-native] img{width:100%;height:100%;object-fit:contain;border-radius:50%;pointer-events:none}
[data-miemie-multiplayer-lobby-native] svg{width:100%;height:100%;box-sizing:border-box;padding:10px;border-radius:50%;pointer-events:none}
@media(hover:hover){[data-miemie-multiplayer-lobby-native]:not([data-ml-tucked]):hover{scale:1.06;box-shadow:0 6px 20px #000a,0 0 18px #c5a66b66}}
[data-miemie-multiplayer-lobby-native]:active{cursor:grabbing}
[data-miemie-multiplayer-lobby-native]:not([data-ml-tucked]):active{scale:.95}
[data-miemie-multiplayer-lobby-native]:focus-visible{outline:2px solid #efdbac;outline-offset:3px}
[data-miemie-multiplayer-lobby-native][data-ml-tucked]{transition:translate 190ms ease-out,border-color .16s,box-shadow .16s}
[data-miemie-multiplayer-lobby-native][data-ml-tucked]:not([data-ml-gesture],[data-ml-expanded]):is([data-ml-hover],[data-ml-peek],:focus-visible){translate:var(--mm-ml-peek) 0}
[data-miemie-multiplayer-lobby-native][data-ml-gesture]{transition:none}
[data-miemie-multiplayer-lobby-native][data-ml-ready]{border-color:#e7cb8d}
[data-miemie-multiplayer-lobby-native][data-ml-gesture=grabbed]{cursor:grabbing;border-color:#e7cb8d;box-shadow:0 0 0 4px #c5a66b45,0 4px 16px #0009;animation:mm-ml-grab 200ms ease-out}
@keyframes mm-ml-grab{from{scale:.92}to{scale:1}}
[data-multiplayer-lobby-pull]{position:fixed;display:block;z-index:2147483299;overflow:hidden;pointer-events:none}
[data-multiplayer-lobby-pull][hidden]{display:none!important}
[data-multiplayer-lobby-pull] path{fill-opacity:.64;stroke:#80adba57;stroke-width:1;transition:fill-opacity .11s,stroke .11s}
[data-multiplayer-lobby-pull][data-ready] path{fill-opacity:1;stroke:#e7cb8d94}
@media(prefers-reduced-motion:reduce){[data-miemie-multiplayer-lobby-native],[data-multiplayer-lobby-pull] path{transition:none!important;animation:none!important}}
`;
