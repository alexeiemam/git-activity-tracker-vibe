import { defineConfig } from "vite";

export default defineConfig(() => {
  const repo = process.env.GITHUB_REPOSITORY
    ? process.env.GITHUB_REPOSITORY.split("/")[1]
    : "";

  const isActions = !!process.env.GITHUB_ACTIONS;

  return {
    // For https://<user>.github.io/<repo>/ we need base="/<repo>/"
    // For local dev or custom domain, base="/"
    base: isActions && repo ? `/${repo}/` : "/",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});