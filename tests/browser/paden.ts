import { fileURLToPath } from "node:url";

/** Where the member's signed-in session is kept between the projects of one run (never committed). */
export const STATE = fileURLToPath(new URL("../../test-results/browser/lid.json", import.meta.url));
