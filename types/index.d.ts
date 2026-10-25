// A moment, in milliseconds since the epoch.
export type EpochMs = number

// The values the tweaks keep in the session's state, read while drawing.
declare module 'claude-code' {
  interface PluginState {
    tweaks: {
      // When each of the person's messages was sent, by the id its row is
      // drawn under (the row's uuid in the transcript); 0 while not known.
      sent: StateFamily<EpochMs>
      // When the person last sent a message in this conversation; 0 before any.
      lastSent: EpochMs
      // The current minute, so the last message line counts on as time passes.
      minute: number
      // Today as YYYY-MM-DD, so stamps that leave out today's date are drawn
      // again when the day changes.
      today: string
    }
  }
}
