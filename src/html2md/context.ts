/*
	変換中に持ち回る状態と、変換の結果。
*/

export interface ConvertContext {
	anchors: Map<string, string>;
	imagesDir: string;
	basePrefix: string;
	figIndex: number;
	images: string[];
	inTitlebar: boolean;
	inSection: boolean;
	hasMinibar: boolean;
	chapterNo: number;
	write: boolean;
	/** style から読んだ CSS 変数。SVG の var() を解決するのに使う */
	cssVars: Map<string, Map<string, string>> | null;
	/** いま処理している章のクラス（chNN）。章の外では空文字 */
	chapterClass: string;
}

export function newContext(): ConvertContext {
	return {
		anchors: new Map<string, string>(),
		imagesDir: '',
		basePrefix: '',
		figIndex: 0,
		images: [],
		inTitlebar: false,
		inSection: false,
		hasMinibar: false,
		chapterNo: 0,
		write: false,
		cssVars: null,
		chapterClass: '',
	};
}

/** 変換した結果 */
export interface ConvertResult {
	htmlPath: string;
	mdPath: string;
	markdown: string;
	images: string[];
}
