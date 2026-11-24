// What the core may read from Herdr, sampled fresh on every render and tick. Passed raw: the core
// decodes the fields it uses, so this file has no opinion about them.
import { spaces, theme, window } from "herdr";

export const snapshot = () => ({ spaces: spaces(), theme: theme(), window: window() });
