/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_MAPS_PROVIDER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
