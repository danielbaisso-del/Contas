import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

function localApiPlugin(): Plugin {
  return {
    name: "contas-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url !== "/api/assistant" && url !== "/api/categorize" && url !== "/api/admin" && url !== "/api/household") {
          next();
          return;
        }
        try {
          const mod = await server.ssrLoadModule("/server/devAdapter.ts");
          if (url === "/api/assistant") await mod.handleAssistant(req, res);
          else if (url === "/api/admin") await mod.handleAdmin(req, res);
          else if (url === "/api/household") await mod.handleHousehold(req, res);
          else await mod.handleCategorize(req, res);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Falha ao iniciar a API local.",
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
});
