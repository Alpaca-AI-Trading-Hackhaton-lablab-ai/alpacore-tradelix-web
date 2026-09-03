import { expect, test } from "@playwright/test";

test("renders TradeLix dashboard without client errors", async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => {
		consoleErrors.push(error.message);
	});

	await page.goto("/", { waitUntil: "networkidle" });

	await expect(page.getByTestId("tradelix-dashboard")).toBeVisible();
	await expect(page.getByRole("heading", { name: "SPY" })).toBeVisible();
	await expect(page.getByRole("button", { name: /Options/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Start$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /Preview plan/i })).toBeVisible();

	expect(consoleErrors).toEqual([]);
});
