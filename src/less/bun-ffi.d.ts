/*
	bun-types を依存に追加せず、less がキー入力の取得に使う分だけ
	最小限の型をここで自前宣言する（tsc --noEmit のためだけ。
	実行時は Bun 本体・bun:ffi の実物を使う）。
*/

declare const Bun: unknown;

declare module 'bun:ffi' {
	export const FFIType: { readonly i32: 'i32' };
	export function dlopen(
		name: string,
		symbols: Record<string, { args: readonly unknown[]; returns: unknown }>
	): { symbols: Record<string, (...args: unknown[]) => number> };
}
