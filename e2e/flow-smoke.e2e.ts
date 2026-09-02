import { expect, test } from "@playwright/test";

async function backendsReady(request: {
	get: (url: string) => Promise<{ ok: () => boolean }>;
}): Promise<boolean> {
	try {
		const checks = await Promise.all([
			request.get("/api/"),
			request.get("/api/bars?symbol=SPY"),
			request.get("/api/models"),
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
	await page.getByRole("button", { name: /Run pipeline/i }).click();
	await expect(page.getByRole("button", { name: /Dry-run/i })).toBeEnabled({
		timeout: 60_000,
	});
	await page.getByRole("button", { name: /Dry-run/i }).click();

	await expect(
		page.getByRole("heading", { name: "Decision Log" }),
	).toBeVisible();
	await expect(page.getByText(/DRY_RUN|NO_TRADE/)).toBeVisible({
		timeout: 30_000,
	});
});
