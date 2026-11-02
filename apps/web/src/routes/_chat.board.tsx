import { createFileRoute } from "@tanstack/react-router";

import { FleetBoardPage } from "../components/board/FleetBoardPage";

export const Route = createFileRoute("/_chat/board")({
  component: FleetBoardPage,
});
