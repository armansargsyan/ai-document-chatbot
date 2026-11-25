import type { Route, UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * Matches `chat` and `chat/:conversationId` with one route config, so the
 * router reuses the chat page when the URL gains the id of a conversation it
 * just created (no reload, no lost state). Kept tiny: it's in the main bundle.
 */
export function chatUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments[0]?.path !== 'chat' || segments.length > 2) return null;
  return {
    consumed: segments,
    posParams: segments[1] ? { conversationId: segments[1] } : {},
  };
}

export const chatRoute: Route = {
  matcher: chatUrlMatcher,
  title: 'Chat | AI Document Chatbot',
  loadComponent: () => import('./chat-page').then((m) => m.ChatPage),
};
