/**
 * Presents the streamed chain of thought to the client that requested it. Which
 * representation a client understands differs, the provider only talks to this
 * interface.
 */
export interface ThinkingReporter {
	/** Reports one piece of the chain of thought. */
	reportReasoning(reasoning: string): void;

	/**
	 * Ends the chain of thought. Has to be called before any other response part
	 * is reported, otherwise a client that echoes the turn back can misread the
	 * answer text as reasoning.
	 */
	closeReasoning(): void;
}
