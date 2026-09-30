import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Assets du pipeline mémoire (ref_cr.docx, helpers_pa.py, validate_docx.py)
  // doivent être copiés dans les builds standalone/tracés.
  outputFileTracingIncludes: {
    "/[org]/tenders/[id]": ["./src/lib/memoire/base/**"],
  },
  // node-unrar-js charge son WASM en interne : ne pas le passer au bundler.
  serverExternalPackages: ["node-unrar-js"],
  experimental: {
    // Les imports DCE (ZIP complets) dépassent largement les défauts Next
    // (1 Mo server action / 10 Mo buffer proxy) — sinon requête rejetée ou
    // corps tronqué et l'action mouline sans rien produire.
    serverActions: { bodySizeLimit: "100mb" },
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
