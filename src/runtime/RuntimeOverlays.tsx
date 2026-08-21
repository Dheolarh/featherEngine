import { CinematicOverlay } from '../components/CinematicOverlay';
import { activeExportProfile } from '../project/exportProfiles';
import { useEditorStore } from '../store/editorStore';
import { DynamicCrosshair } from '../ui/DynamicCrosshair';
import { GameHud } from '../ui/GameHud';
import { MiniMap } from '../ui/MiniMap';
import { ScreenUILayer } from '../ui/ScreenUILayer';
import { DebugOverlay } from '../player/PlayerDiagnostics';

/** Exact DOM runtime surface shared by editor Play and the standalone/exported Player. */
export function RuntimeOverlays() {
  const includeDiagnostics = useEditorStore((state) => activeExportProfile(state.exportSettings).includeDebugOverlay);
  return (
    <>
      <ScreenUILayer />
      <DynamicCrosshair />
      <GameHud />
      <MiniMap />
      <CinematicOverlay />
      {includeDiagnostics && <DebugOverlay />}
    </>
  );
}
