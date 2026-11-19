import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

const SidebarView = Schema.Literals(["work", "repo"]);
type SidebarView = typeof SidebarView.Type;

/** Fleet fork: whether the sidebar shows the Board's Work view or the chats by repo. */
export function useSidebarView() {
  return useLocalStorage("t3-fleet:sidebar-view", "work" as SidebarView, SidebarView);
}

export function SidebarViewToggle(props: {
  readonly value: SidebarView;
  readonly onChange: (value: SidebarView) => void;
}) {
  return (
    <div className="px-2 pt-1 pb-1">
      <ToggleGroup
        aria-label="Sidebar view"
        value={[props.value]}
        onValueChange={(value) => {
          if (value[0] === "work" || value[0] === "repo") props.onChange(value[0]);
        }}
      >
        <Toggle value="work">Work</Toggle>
        <Toggle value="repo">By repo</Toggle>
      </ToggleGroup>
    </div>
  );
}
