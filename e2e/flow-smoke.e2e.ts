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
	await expect(page.getByRole("button", { name: /^Start$/i })).toBeVisible();
	const preview = page.getByRole("button", { name: /Preview plan/i });
	await expect(preview).toBeVisible();
	if (await preview.isEnabled()) {
		await preview.click();
		await expect(
			page.getByRole("heading", { name: "Decision Log" }),
		).toBeVisible();
	}
});
