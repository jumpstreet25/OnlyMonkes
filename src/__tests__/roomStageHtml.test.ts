jest.mock("expo-asset", () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock("expo-file-system/legacy", () => ({ readAsStringAsync: jest.fn() }));
import { readFileSync } from "fs";
import { join } from "path";
import { inlineRoomStage } from "@/lib/roomStageHtml";

const A = (f: string) => readFileSync(join(__dirname, "../../assets/viewer", f), "utf8");

describe("inlineRoomStage (bundled 3D stage)", () => {
  const room = A("room.html");
  const html = inlineRoomStage(room, A("three.module.min.js.txt"), A("three.core.min.js.txt"), A("monkeModel.js.txt"));

  it("drops the CDN import map and nothing else loads from jsDelivr", () => {
    expect(room).toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("cdn.jsdelivr.net/npm/three");
    expect(html).toContain("document.write('<script type=\"importmap\">'");
  });
  it("renames three.module's relative core import to the import-map entry", () => {
    expect(html).not.toContain('from"./three.core.min.js"');
    expect(html).toContain('from\\"three-core\\"');
  });
  it("keeps the page's own module script after the boot script, and no source can close the inline script", () => {
    const boot = html.indexOf("URL.createObjectURL");
    expect(boot).toBeGreaterThan(0);
    expect(html.indexOf('<script type="module">')).toBeGreaterThan(boot);
    const bootScript = html.slice(html.lastIndexOf("<script>", boot), html.indexOf("</script>", boot));
    expect(bootScript).not.toMatch(/<\/script/i);
  });
});
