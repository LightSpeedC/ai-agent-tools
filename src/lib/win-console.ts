/*
	Windows コンソールへ ANSI エスケープシーケンス（色・カーソル制御等）を
	安全に出すための共通処理。Bun 専用（bun:ffi を使う）。

	Bun は ENABLE_VIRTUAL_TERMINAL_PROCESSING（VT100 エスケープ解釈）を
	自動で有効化しない。明示しないと、エスケープシーケンスがそのまま
	文字として表示されることがある（less・psls の両方で実機にて確認済み）。

	このフラグはプロセスではなくコンソール（画面バッファ）側の設定のため、
	何もしなければプロセスが終了してもそのコンソールに残り続ける
	（実機で確認済み）。呼び出し側が終了時に元へ戻せるよう、
	戻すための関数を返す。

	コードページ（SetConsoleOutputCP）はここでは扱わない。呼べば成功は
	返るが、外部から chcp で見える値が変わらないことを実機で確認した。
	bun:ffi 経由・PowerShell の P/Invoke 経由のどちらで呼んでも同じ結果
	だったため、Bun 固有の問題ではなく、この環境では効かない API という
	扱いにしている。日本語がそのまま出せているのはこの呼び出しのおかげ
	ではなかった（notes/10_plan/i260917-01-less.html の「落とし穴（8）」を参照）。

	失敗しても呼び出し側の処理は続ける（Bun 以外・コンソールが無い環境・
	出力先がリダイレクトされている環境等では、そもそも要らない／効かない）。
*/

const STD_OUTPUT_HANDLE = -11;
const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004;

/** 何もしない、または失敗時に返す既定の戻し関数 */
const noop = (): void => {};

/**
 * コンソール出力を VT100 解釈ありへ切り替える。
 * 戻り値は、切り替え前の状態へ戻す関数（終了時に呼ぶ）
 */
export async function enableWindowsConsoleVt(): Promise<() => void> {
	try {
		const { dlopen, FFIType, ptr } = await import('bun:ffi');
		const { symbols: k32 } = dlopen('kernel32.dll', {
			GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
			GetConsoleMode: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
			SetConsoleMode: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		});
		const ptrOf = (b: Uint8Array) => Number(ptr(b));

		// 標準出力がコンソールでなければ（リダイレクト等）ここで失敗して当然
		const h = k32.GetStdHandle(STD_OUTPUT_HANDLE);
		if (!h) { return noop; }

		const modeBuf = new Uint8Array(4);
		if (!k32.GetConsoleMode(h, ptrOf(modeBuf))) { return noop; }
		const originalMode = new DataView(modeBuf.buffer).getUint32(0, true);
		k32.SetConsoleMode(h, originalMode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);

		return () => {
			try { k32.SetConsoleMode(h, originalMode); } catch { /* 戻せなくても致命的ではない */ }
		};
	} catch {
		return noop;
	}
}
