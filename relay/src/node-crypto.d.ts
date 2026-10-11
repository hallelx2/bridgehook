// The relay compiles against @cloudflare/workers-types only, which does not
// describe Node's built-ins. Workers implements node:crypto natively under the
// `nodejs_compat` flag; this declares the one function the relay uses.
declare module "node:crypto" {
	export function scrypt(
		password: string | Uint8Array,
		salt: string | Uint8Array,
		keylen: number,
		options: { N?: number; r?: number; p?: number; maxmem?: number },
		callback: (err: Error | null, derivedKey: Uint8Array) => void,
	): void;
}
