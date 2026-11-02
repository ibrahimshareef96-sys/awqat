/**
 * ElevenLabs' voice library (@elevenlabs/client 1.26.0, MIT; it brings livekit-client, Apache-2.0), loaded only when a
 * talk starts, so the app opens as fast as before.
 */
export type ConversationClass = typeof import("@elevenlabs/client").Conversation;

export async function loadConversation(): Promise<ConversationClass> {
  return (await import("@elevenlabs/client")).Conversation;
}
