import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

/**
 * Fleet fork: how the sidebar orders chats. "fixed" holds each chat where it is
 * (new chats on top), so the list stays a stable visual
 * reference; "activity" is the stock order, where sending moves a chat up.
 */
const FleetSidebarOrder = Schema.Literals(["fixed", "activity"]);
export type FleetSidebarOrder = typeof FleetSidebarOrder.Type;

const FLEET_SIDEBAR_ORDER_KEY = "t3-fleet:sidebar-order";

export function useFleetSidebarOrder() {
  return useLocalStorage<FleetSidebarOrder, FleetSidebarOrder>(
    FLEET_SIDEBAR_ORDER_KEY,
    "fixed",
    FleetSidebarOrder,
  );
}
