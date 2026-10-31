import type { CritterState } from "@/lib/mascot";

export interface SceneProps {
  playing: boolean;
  onCue?: (state: CritterState) => void;
  onEnded?: () => void;
  label: string;
}
