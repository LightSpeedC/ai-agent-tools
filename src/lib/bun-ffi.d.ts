/*
	bun-types を依存に追加せず、bun:ffi を使うツール（less・process-list）が
	使う分だけ最小限の型をここに自前宣言する（tsc --noEmit のためだけ。
	実行時は Bun 本体・bun:ffi の実物を使う）。1ファイルに集約し、
	ツールごとに重複した宣言（同じモジュールへの食い違う宣言）を持たない。
*/

declare const Bun: unknown;

declare module 'bun:ffi' {
	export type Pointer = number | bigint;

	export const FFIType: {
		readonly i8: 'i8';
		readonly u8: 'u8';
		readonly i16: 'i16';
		readonly u16: 'u16';
		readonly i32: 'i32';
		readonly u32: 'u32';
		readonly i64: 'i64';
		readonly u64: 'u64';
		readonly ptr: 'ptr';
		readonly cstring: 'cstring';
	};

	export function dlopen(
		name: string,
		symbols: Record<string, { args: readonly unknown[]; returns: unknown }>
	): { symbols: Record<string, (...args: unknown[]) => number> };

	/** 確保済みの Buffer/TypedArray をネイティブ関数へ渡すためのポインタ値にする */
	export function ptr(buffer: ArrayBufferView | ArrayBuffer, byteOffset?: number): Pointer;

	/** ネイティブが返したポインタの指す先を、コピーして ArrayBuffer にする */
	export function toArrayBuffer(pointer: Pointer, byteOffset?: number, byteLength?: number): ArrayBuffer;

	/** ネイティブが返したポインタの指す先を、コピーせず直接読む */
	export const read: {
		u8(pointer: Pointer, offset?: number): number;
		u16(pointer: Pointer, offset?: number): number;
		u32(pointer: Pointer, offset?: number): number;
		u64(pointer: Pointer, offset?: number): bigint;
		i32(pointer: Pointer, offset?: number): number;
		ptr(pointer: Pointer, offset?: number): Pointer;
	};
}
