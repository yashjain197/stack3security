import { defineConfig } from "wxt";

// WXT configuration for the Stack3 Security extension.
// - `npm run dev` launches Chrome with hot reload.
// - `npm run build` outputs the production extension to .output/chrome-mv3.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Stack3 Security",
    description: "Verify what happens underneath websites, transactions, and contracts before you act.",
    permissions: ["activeTab", "tabs", "storage", "alarms"],
    host_permissions: ["https://stack3security.onrender.com/*", "http://localhost:8000/*"],
  },
});
