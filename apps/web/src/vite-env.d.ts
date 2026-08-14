/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API, without a trailing slash. Defaults to localhost:3000. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
