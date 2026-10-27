/**
 * The Avatar Room 3D stage, bundled (3.1). The phone used to load https://onlymonkes.app/viewer/room
 * plus three.js from jsDelivr — dead on networks that block the young domain and offline. Now
 * room.html, monkeModel.js and three.js 0.185.1 (module + core) ship as assets
 * (assets/viewer/, copied from web-app public/viewer — keep in step with the web viewer).
 *
 * The page's import map pointed at the CDN; here it's rewritten to blob: URLs built from the
 * bundled sources before the page's module script runs. three.module imports
 * "./three.core.min.js" relatively, which can't resolve from a blob, so that one specifier is
 * renamed to an import-map entry. Monke art still loads from Arweave (a room is online anyway).
 */
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

let _html: Promise<string> | null = null;

async function readAsset(mod: number): Promise<string> {
  const a = Asset.fromModule(mod);
  await a.downloadAsync();
  return FileSystem.readAsStringAsync(a.localUri ?? a.uri);
}

/** A JS string literal that's safe inside an inline <script>. */
const lit = (s: string) => JSON.stringify(s).replace(/<\//g, "<\\/");

/** Pure: room.html with its CDN import map replaced by bundled blob modules. */
export function inlineRoomStage(room: string, threeModule: string, threeCore: string, monkeModel: string): string {
  const mod = threeModule.replace(/from\s*"\.\/three\.core\.min\.js"/g, 'from"three-core"');
  if (mod === threeModule) throw new Error("three.module no longer imports ./three.core.min.js — re-check the bundle");
  const boot =
    "<script>(function(){" +
    "function u(s){return URL.createObjectURL(new Blob([s],{type:'text/javascript'}))}" +
    `var core=u(${lit(threeCore)});var three=u(${lit(mod)});var monke=u(${lit(monkeModel)});` +
    "document.write('<script type=\"importmap\">'+JSON.stringify({imports:{'three-core':core,'three':three,'/viewer/monkeModel.js':monke}})+'<\\/script>');" +
    "})();</script>";
  const out = room.replace(/<script type="importmap">[\s\S]*?<\/script>/, () => boot);
  if (out === room) throw new Error("room.html has no import map to replace");
  return out;
}

/** The self-contained stage page (built once per app run). */
export function bundledRoomStageHtml(): Promise<string> {
  if (!_html) {
    _html = Promise.all([
      readAsset(require("../../assets/viewer/room.html")),
      readAsset(require("../../assets/viewer/three.module.min.js.txt")),
      readAsset(require("../../assets/viewer/three.core.min.js.txt")),
      readAsset(require("../../assets/viewer/monkeModel.js.txt")),
    ]).then(([room, three, core, monke]) => inlineRoomStage(room, three, core, monke));
    _html.catch(() => { _html = null; });
  }
  return _html;
}
