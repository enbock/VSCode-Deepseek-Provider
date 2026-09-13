/**
 * DeepSeek uses a BPE tokenizer, so this heuristic (CJK ≈ 1 token, other
 * characters in blocks of four) is only for context-window bookkeeping.
 */
export class TokenEstimator {
	estimate(text: string): number {
		if (text.length === 0) {
			return 0;
		}

		let tokens = 0;
		let asciiRun = 0;

		for (const char of text) {
			if (this.isCjk(char)) {
				tokens += Math.ceil(asciiRun / 4);
				asciiRun = 0;
				tokens += 1;
			} else {
				asciiRun += 1;
			}
		}

		tokens += Math.ceil(asciiRun / 4);
		return tokens;
	}

	private isCjk(char: string): boolean {
		const code = char.codePointAt(0) ?? 0;
		return (
			(code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
			(code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
			(code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
			(code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
			(code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
			(code >= 0xac00 && code <= 0xd7af) // Hangul syllables
		);
	}
}
