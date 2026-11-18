import { createContext } from "react";

/**
 * Fleet fork: true when a chat renders inside another surface's window (the board's work
 * window), which shows the work's details itself. The thread details card then stays a popover
 * behind its header button instead of docking beside the chat.
 */
export const ChatEmbedContext = createContext(false);
