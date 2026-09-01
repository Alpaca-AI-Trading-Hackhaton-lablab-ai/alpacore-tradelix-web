import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_APP_TITLE: z.string().min(1).default("TradeLix AI"),
		VITE_API_URL: z.string().min(1).default("/api"),
		VITE_DEFAULT_SYMBOL: z.string().min(1).default("SPY"),
	},
	runtimeEnv: import.meta.env,
	emptyStringAsUndefined: true,
});
