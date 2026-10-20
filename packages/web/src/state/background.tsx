/** Local wallpaper preferences. Image bytes are stored separately so a slider writes only settings. */
import { createContext, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export const BACKGROUND_IMAGE_KEY = "penguin.background.image";
export const BACKGROUND_PRESET_KEY = "penguin.background.preset";
export const BACKGROUND_SETTINGS_KEY = "penguin.background.settings";
export const BACKGROUND_MODES = ["cover", "contain", "tile", "original"] as const;
export const BACKGROUND_POSITIONS = [
  "left top",
  "center top",
  "right top",
  "left center",
  "center center",
  "right center",
  "left bottom",
  "center bottom",
  "right bottom",
] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number];

/**
 * Bundled textures. Each is a 1600×900 webp with a deliberate alpha channel, so it composites
 * over the canvas instead of covering it; the light/dark pair follows the theme's mode. Only the
 * id is persisted — the URLs are resolved at render time, keeping localStorage free of image data.
 */
export const BACKGROUND_PRESET_IDS = ["yuanshan", "shanshui", "pamir", "sayram"] as const;
export type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number];

const RELIEF_DIR = `${import.meta.env.BASE_URL}relief/`;
export const BACKGROUND_PRESETS: Record<BackgroundPresetId, { light: string; dark: string }> = {
  yuanshan: { light: `${RELIEF_DIR}yuanshan-light.webp`, dark: `${RELIEF_DIR}yuanshan-dark.webp` },
  shanshui: { light: `${RELIEF_DIR}shanshui-light.webp`, dark: `${RELIEF_DIR}shanshui-dark.webp` },
  pamir: { light: `${RELIEF_DIR}pamir-light.webp`, dark: `${RELIEF_DIR}pamir-dark.webp` },
  sayram: { light: `${RELIEF_DIR}sayram-light.webp`, dark: `${RELIEF_DIR}sayram-dark.webp` },
};

/** The texture's URL for the active mode. */
export function presetImage(id: BackgroundPresetId, dark: boolean): string {
  const preset = BACKGROUND_PRESETS[id];
  return dark ? preset.dark : preset.light;
}

/**
 * What a preset is applied with. A user-chosen picture is opaque, so its default of 80% opacity
 * reads correctly; a texture already carries alpha, and the same 80% would fade it to nothing.
 * `cover` plus a bottom anchor is what the 16:9 artwork is drawn for.
 */
export const BACKGROUND_PRESET_SETTINGS: BackgroundSettings = {
  transparency: 25,
  mode: "cover",
  position: "center bottom",
};

export interface BackgroundSettings {
  transparency: number;
  mode: BackgroundMode;
  position: BackgroundPosition;
}
export const BACKGROUND_DEFAULT_SETTINGS: BackgroundSettings = {
  transparency: 80,
  mode: "cover",
  position: "center center",
};

/** Only locally encoded raster data is allowed into a CSS image value. */
export function isBackgroundImage(value: unknown): value is string {
  return (
    typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  );
}

function readBackground(): {
  image: string | null;
  preset: BackgroundPresetId | null;
  settings: BackgroundSettings;
} {
  let image: string | null = null;
  let preset: BackgroundPresetId | null = null;
  let settings = BACKGROUND_DEFAULT_SETTINGS;
  try {
    const storedPreset = localStorage.getItem(BACKGROUND_PRESET_KEY);
    preset = BACKGROUND_PRESET_IDS.find((id) => id === storedPreset) ?? null;
    const storedImage = localStorage.getItem(BACKGROUND_IMAGE_KEY);
    // A preset wins over a stale picture: the setters keep the two keys exclusive, so both can
    // only be present if a write was interrupted, and the preset is what the user last chose.
    if (preset === null && isBackgroundImage(storedImage)) image = storedImage;
    const stored: unknown = JSON.parse(localStorage.getItem(BACKGROUND_SETTINGS_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      const value = stored as Partial<BackgroundSettings>;
      settings = {
        transparency:
          typeof value.transparency === "number" && Number.isFinite(value.transparency)
            ? Math.min(100, Math.max(0, value.transparency))
            : BACKGROUND_DEFAULT_SETTINGS.transparency,
        mode: BACKGROUND_MODES.find((mode) => mode === value.mode) ?? BACKGROUND_DEFAULT_SETTINGS.mode,
        position:
          BACKGROUND_POSITIONS.find((position) => position === value.position) ??
          BACKGROUND_DEFAULT_SETTINGS.position,
      };
    }
  } catch {
    // Blocked storage or an incomplete settings value must not prevent the app from opening.
  }
  return { image, preset, settings };
}

export function backgroundStyle(image: string | null, settings: BackgroundSettings): CSSProperties {
  return {
    backgroundImage: image === null ? "none" : `url("${image}")`,
    backgroundSize:
      settings.mode === "tile" || settings.mode === "original" ? "auto" : settings.mode,
    backgroundRepeat: settings.mode === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: settings.position,
    opacity: 1 - settings.transparency / 100,
  };
}

interface BackgroundContextValue {
  image: string | null;
  preset: BackgroundPresetId | null;
  settings: BackgroundSettings;
  setImage: (image: string | null) => void;
  /** Apply (or clear) a bundled texture; an optional settings object lands in the same write. */
  setPreset: (preset: BackgroundPresetId | null, settings?: BackgroundSettings) => void;
  setSettings: (settings: BackgroundSettings) => void;
}
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readBackground);
  const [image, setImageState] = useState(initial.image);
  const [preset, setPresetState] = useState(initial.preset);
  const [settings, setSettingsState] = useState(initial.settings);

  return (
    <BackgroundContext.Provider
      value={{
        image,
        preset,
        settings,
        setImage: (next) => {
          if (next === null) {
            localStorage.removeItem(BACKGROUND_IMAGE_KEY);
            localStorage.removeItem(BACKGROUND_PRESET_KEY);
          } else {
            if (!isBackgroundImage(next)) throw new Error("Invalid background image");
            localStorage.setItem(BACKGROUND_IMAGE_KEY, next);
            localStorage.removeItem(BACKGROUND_PRESET_KEY);
          }
          // A failed write leaves both the current source and the current controls untouched.
          setImageState(next);
          if (next === null) setPresetState(null);
        },
        setPreset: (next, nextSettings) => {
          if (next === null) {
            localStorage.removeItem(BACKGROUND_PRESET_KEY);
            localStorage.removeItem(BACKGROUND_IMAGE_KEY);
          } else {
            localStorage.setItem(BACKGROUND_PRESET_KEY, next);
            localStorage.removeItem(BACKGROUND_IMAGE_KEY);
            if (nextSettings !== undefined) {
              localStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(nextSettings));
            }
          }
          // Every write above precedes the state change: a refused write leaves the view alone.
          setPresetState(next);
          setImageState(null);
          if (nextSettings !== undefined) setSettingsState(nextSettings);
        },
        setSettings: (next) => {
          localStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
          setSettingsState(next);
        },
      }}
    >
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (!context) throw new Error("useBackground must be used within a BackgroundProvider");
  return context;
}
