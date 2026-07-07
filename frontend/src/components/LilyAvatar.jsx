/**
 * Lily — smart avatar wrapper.
 *
 * Default mode is real 3D via <LilyVrmAvatar /> (three.js + @pixiv/three-vrm).
 * If the VRM fails to load, we fall back automatically to the 2.5D image
 * overlay renderer so the widget is never blank. You can also force the
 * fallback by passing `mode="2d"` or `vrmUrl={null}`.
 */
import { useCallback, useState } from "react";
import LilyVrmAvatar from "./LilyVrmAvatar";
import LilyLiveAvatar from "./LilyLiveAvatar";

export default function LilyAvatar({
  mode = "3d",           // "3d" | "2d"
  vrmUrl = "/models/lily.vrm",
  size = 160,
  emotion = "friendly",
  speaking = false,
  showLabel = false,
  imageUrl,              // used by 2D fallback
}) {
  const [use2d, setUse2d] = useState(mode === "2d" || !vrmUrl);

  const handleError = useCallback(() => {
    console.warn("[LilyAvatar] VRM failed — falling back to 2.5D layer");
    setUse2d(true);
  }, []);

  if (use2d) {
    return (
      <LilyLiveAvatar
        size={size}
        emotion={emotion}
        speaking={speaking}
        showLabel={showLabel}
        imageUrl={imageUrl}
      />
    );
  }
  return (
    <LilyVrmAvatar
      vrmUrl={vrmUrl}
      size={size}
      emotion={emotion}
      speaking={speaking}
      showLabel={showLabel}
      onError={handleError}
    />
  );
}

export const EMOTION_LABELS = {
  neutral:   { label: "Neutral",   emoji: "😐" },
  happy:     { label: "Happy",     emoji: "😄" },
  friendly:  { label: "Friendly",  emoji: "😊" },
  thinking:  { label: "Thinking",  emoji: "🤔" },
  greeting:  { label: "Greeting",  emoji: "👋" },
  concerned: { label: "Concerned", emoji: "😟" },
};
