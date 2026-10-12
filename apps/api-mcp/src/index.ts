import { createServer } from "node:http";

import { createContext, runMaintenance } from "./context.js";
import { loadConfig } from "./config.js";
import { logEvent } from "./log.js";
import { createRequestHandler } from "./routes.js";

const MAINTENANCE_INTERVAL_MS = 60_000;

const config = loadConfig();
const ctx = createContext(config);
const server = createServer(createRequestHandler(ctx));

setInterval(() => {
  runMaintenance(ctx).catch(() => logEvent("maintenance.error"));
}, MAINTENANCE_INTERVAL_MS).unref();

server.listen(config.port, () => {
  logEvent("server.listening", { port: config.port });
});
