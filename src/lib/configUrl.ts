import { Platform } from "react-native";

/** A config/ file from master on GitHub; on the website through onlymonkes.app
 *  (scripts/web/site-router.ts /svc/config), since company filters often block
 *  raw.githubusercontent.com. */
export function configFileUrl(file: string): string {
  return Platform.OS === "web"
    ? `/svc/config/${file.replace(/^config\//, "")}`
    : `https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/${file}`;
}
