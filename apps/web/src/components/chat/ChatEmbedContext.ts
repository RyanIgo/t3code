import { createContext } from "react";

/**
 * Fleet fork: true when a chat renders inside another surface's window (the board's work
 * window), which shows the work's details itself. The thread details card then stays a popover
 * behind its header button instead of docking beside the chat.
 */
export const ChatEmbedContext = createContext(false);

/**
 * Fleet fork: true when the chat is shown to look at, not to read: the board's work window. It then
 * doesn't record a visit, so a finished chat stays "Result ready" until Rigo marks it reviewed,
 * instead of clearing the moment it's opened (and dropping off his lists if he closes it unread).
 */
export const ChatPeekContext = createContext(false);
