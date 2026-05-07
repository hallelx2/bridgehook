/**
 * Mailer abstraction. Self-hosters can swap in their own provider by
 * implementing the BridgeMailer interface — the rest of the relay only
 * cares about the contract, not the SDK.
 *
 * Default implementations:
 *   - ResendMailer    : production. Requires RESEND_API_KEY.
 *   - ConsoleMailer   : dev / self-host fallback. Logs the URL to stdout.
 */
import { Resend } from "resend";

export interface BridgeMailer {
	sendMagicLink(args: { to: string; url: string; expiresInMinutes: number }): Promise<void>;
}

const FROM_DEFAULT = "BridgeHook <noreply@bridgehook.dev>";

export class ResendMailer implements BridgeMailer {
	private resend: Resend;
	private from: string;

	constructor(apiKey: string, from = FROM_DEFAULT) {
		this.resend = new Resend(apiKey);
		this.from = from;
	}

	async sendMagicLink({
		to,
		url,
		expiresInMinutes,
	}: {
		to: string;
		url: string;
		expiresInMinutes: number;
	}): Promise<void> {
		const html = magicLinkHtml(url, expiresInMinutes);
		const text = magicLinkText(url, expiresInMinutes);
		await this.resend.emails.send({
			from: this.from,
			to,
			subject: "Your BridgeHook sign-in link",
			html,
			text,
		});
	}
}

/**
 * Logs magic-link URLs to stdout. Useful for local dev (no email account
 * needed) and for self-hosters who don't want to wire an email provider —
 * they can paste the link from logs into the browser themselves.
 */
export class ConsoleMailer implements BridgeMailer {
	async sendMagicLink({ to, url, expiresInMinutes }: { to: string; url: string; expiresInMinutes: number }): Promise<void> {
		console.log(
			`[mailer] magic-link for ${to} (expires in ${expiresInMinutes}m):\n  ${url}`,
		);
	}
}

export function pickMailer(env: { RESEND_API_KEY?: string; MAIL_FROM?: string }): BridgeMailer {
	if (env.RESEND_API_KEY) {
		return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM || FROM_DEFAULT);
	}
	return new ConsoleMailer();
}

function magicLinkHtml(url: string, expiresInMinutes: number): string {
	const safeUrl = escapeHtml(url);
	return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0a0a0a;background:#fafafa;margin:0;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">Sign in to BridgeHook</h1>
    <p style="margin:0 0 24px">Click the link below to sign in. It expires in ${expiresInMinutes} minutes and can only be used once.</p>
    <p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;background:#ccff00;color:#0a0a0a;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in</a></p>
    <p style="margin:0;color:#737373;font-size:13px">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all">${safeUrl}</span></p>
  </div>
</body></html>`;
}

function magicLinkText(url: string, expiresInMinutes: number): string {
	return `Sign in to BridgeHook

Click the link below to sign in. It expires in ${expiresInMinutes} minutes and can only be used once.

${url}

If you didn't request this, ignore this email.`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
