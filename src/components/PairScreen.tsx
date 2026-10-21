import { Redirect } from "expo-router";

/** Native: /pair is the web app's phone-approval page; the app has no use for it. */
export default function PairScreen() {
  return <Redirect href="/" />;
}
