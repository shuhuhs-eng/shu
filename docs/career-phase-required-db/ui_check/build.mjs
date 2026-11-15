import { build } from "esbuild";
const D = process.argv[2]; const E = process.argv[3] ?? "entry"; const OUT = process.argv[4] ?? "bundle";
await build({ entryPoints: [D + "/" + E + ".tsx"], bundle: true, outfile: D + "/" + OUT + ".js", jsx: "automatic", loader: { ".tsx": "tsx" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { react: "/home/claude/shu/node_modules/react", "react-dom": "/home/claude/shu/node_modules/react-dom", "@": "/home/claude/shu" },
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: D + "/stubs.tsx" }));
    b.onResolve({ filter: /^@\/lib\/profile\/actions$/ }, () => ({ path: D + "/stubs.tsx" }));
    b.onResolve({ filter: /^@\/components\/profile\/avatar-uploader$/ }, () => ({ path: D + "/stubs.tsx" }));
  } }] });
