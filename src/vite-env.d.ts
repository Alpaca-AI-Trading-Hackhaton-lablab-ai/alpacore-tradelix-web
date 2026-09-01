/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APP_TITLE?: string;
	readonly VITE_RUNTIME_URL?: string;
	readonly VITE_INTEROP_URL?: string;
	readonly VITE_MANDATE_URL?: string;
	readonly VITE_SERVICE_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
