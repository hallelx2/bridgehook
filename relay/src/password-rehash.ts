/**
 * Upgrades weak password hashes in place on the next successful sign-in.
 *
 * Accounts created before the move to 600,000 PBKDF2 iterations still hold
 * hashes at the launch cost (10,000). The plaintext is only ever available
 * while the user signs in, so this Better-Auth after-hook runs once a
 * session has been created for `/sign-in/email`, checks the stored hash,
 * and rewrites it at the current cost when it is weaker.
 *
 * A failed rewrite never fails the sign-in: the user is already
 * authenticated, and the next sign-in tries again.
 */
import { createAuthMiddleware } from "better-auth/api";
import { needsRehash } from "./password.js";

export const rehashOnSignIn = createAuthMiddleware(async (ctx) => {
	if (ctx.path !== "/sign-in/email") return;

	const userId = ctx.context.newSession?.user.id;
	const password = (ctx.body as { password?: unknown } | undefined)?.password;
	if (!userId || typeof password !== "string") return;

	try {
		const accounts = await ctx.context.internalAdapter.findAccounts(userId);
		const credential = accounts.find(
			(a) => a.providerId === "credential" && a.accountId === userId,
		);
		if (!credential?.password || !needsRehash(credential.password)) return;

		const upgraded = await ctx.context.password.hash(password);
		await ctx.context.internalAdapter.updatePassword(userId, upgraded);
	} catch (err) {
		console.error("password rehash failed:", err);
	}
});
