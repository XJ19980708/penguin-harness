/** Local wallpaper preferences. Image bytes are stored separately so a slider writes only settings. */
import { createContext, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BACKGROUND_STORAGE_KEYS,
  DEFAULT_BACKGROUND_SETTINGS,
  backgroundLayerStyle,
  isBackgroundImage,
  readBackground,
} from "@prismshadow/penguin-ui/boot";
import type { BackgroundSettings } from "@prismshadow/penguin-ui/boot";

// The keys, the vocabulary and the reader are the shared package's (`@prismshadow/penguin-ui/boot`):
// the pre-paint script reads the same store, so a reload paints the image from the first frame.
export {
  BACKGROUND_MODES,
  BACKGROUND_POSITIONS,
  isBackgroundImage,
} from "@prismshadow/penguin-ui/boot";
export type {
  BackgroundMode,
  BackgroundPosition,
  BackgroundSettings,
} from "@prismshadow/penguin-ui/boot";

export const BACKGROUND_IMAGE_KEY = BACKGROUND_STORAGE_KEYS.image;
export const BACKGROUND_SETTINGS_KEY = BACKGROUND_STORAGE_KEYS.settings;
// The presets are the web layer's own: the pre-paint script paints a stored picture, never a
// bundled texture, so this key stays outside the shared store's vocabulary.
export const BACKGROUND_PRESET_KEY = "penguin.background.preset";

/** The shared defaults, under the name this package's consumers already use. */
export const BACKGROUND_DEFAULT_SETTINGS = DEFAULT_BACKGROUND_SETTINGS;

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

export function backgroundStyle(image: string | null, settings: BackgroundSettings): CSSProperties {
  return backgroundLayerStyle(image, settings);
}

/** The stored background: the shared reader's image and settings, plus the preset only the web layer knows. */
function storedBackground(): {
  image: string | null;
  preset: BackgroundPresetId | null;
  settings: BackgroundSettings;
} {
  const read = (storage: Pick<Storage, "getItem">) => {
    const stored = readBackground(storage);
    const preset =
      BACKGROUND_PRESET_IDS.find((id) => id === storage.getItem(BACKGROUND_PRESET_KEY)) ?? null;
    // A preset wins over a stale picture: the setters keep the two keys exclusive, so both can
    // only be present if a write was interrupted, and the preset is what the user last chose.
    return { image: preset === null ? stored.image : null, preset, settings: stored.settings };
  };
  try {
    return read(localStorage);
  } catch {
    return read({ getItem: () => null });
  }
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
  const [initial] = useState(storedBackground);
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
