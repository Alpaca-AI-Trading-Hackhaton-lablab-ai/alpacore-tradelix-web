import { expect, test } from "@playwright/test";

async function backendsReady(request: {
	get: (url: string) => Promise<{ ok: () => boolean }>;
}): Promise<boolean> {
	try {
		const checks = await Promise.all([
			request.get("/api/"),
			request.get("/api/market-state"),
			request.get("/api/decision"),
		]);
		return checks.every((response) => response.ok());
	} catch {
		return false;
	}
}

test("records a dry-run preview against the Python PoC", async ({
	page,
	request,
}) => {
	test.skip(
		!(await backendsReady(request)),
		"FastAPI backend not available on :8000",
	);

	await page.goto("/", { waitUntil: "networkidle" });
	await page.getByRole("button", { name: /Dry-run/i }).click();

	await expect(
		page.getByRole("heading", { name: "Decision Log" }),
	).toBeVisible();
	await expect(page.getByText(/DRY_RUN|NO_TRADE/)).toBeVisible({
		timeout: 30_000,
	});
});
