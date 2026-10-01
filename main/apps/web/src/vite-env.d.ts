/// <reference types="vite/client" />

// Markdown imported as text (`import doc from '.../cookie-policy.md?raw'`).
// Vite resolves the `?raw` query at build time; this tells TypeScript so.
declare module '*.md?raw' {
  const src: string;
  export default src;
}
