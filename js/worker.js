// The extension's service worker: everything that happens with no tab open.
// Each half registers its own listeners; this only brings them up together.

import "./clip/background.js";
import "./float/background.js";
import "./notify/worker.js";
import "./bridge/background.js";
