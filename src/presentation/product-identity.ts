import {PRODUCT_IDENTITY} from '../../product.mjs';
import packageInfo from '../../package.json';
export const MULTIPLAYER_LOBBY_PRODUCT = Object.freeze({...PRODUCT_IDENTITY,version:packageInfo.version});
export const MULTIPLAYER_LOBBY_DOCK_KEY='miemie_multiplayer_lobby_dock_v1';
